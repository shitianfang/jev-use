/**
 * Secrets never need to reach the judge.
 *
 * The state you write is yours — `judge` sends it verbatim. A gated action is
 * different: it arrives mechanically. The PreToolUse hook hands over whatever
 * the agent proposed, so a token pasted into a `curl` header or a `psql` URL
 * would leave the machine inside the judged state without anyone choosing to
 * send it. `redactSecrets` removes the secret VALUES and keeps everything a
 * safety judgment reads — the tool, the flags, the host, the path:
 *
 *   psql postgres://app:[redacted]@db.internal:5432/orders -c 'drop table …'
 *
 * Rules are a table, so adding one is a line. Each pattern captures what to
 * keep and then the secret; trailing context goes in a lookahead.
 */
/** What replaces a secret, in the judged state and nowhere else. */
export const REDACTED = "[redacted]";
const RULES = [
    {
        name: "password in a URL",
        pattern: /(\b[a-z][\w+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(?=@)/gi,
    },
    {
        name: "auth header",
        pattern: /((?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)"?\s*:\s*"?(?:(?:bearer|basic|token|digest)\s+)?)([^"'\n\\]+)/gi,
    },
    {
        name: "credential flag",
        pattern: /((?:^|\s)--?[\w-]*(?:pass(?:wd|word)?|token|api-?key|secret|auth)[\w-]*[ =]+"?)([^\s"'\\]+)/gi,
    },
    {
        name: "user:password flag",
        pattern: /((?:^|\s)(?:-u|--user)[ =]+"?[^\s:"']*:)([^\s"'\\]+)/g,
    },
    {
        name: "secret-looking name = value",
        pattern: /(["']?[\w.-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)["']?\s*[:=]\s*"?)([^\s"',;}\\]+)/gi,
    },
    { name: "OpenAI-style key", pattern: /(sk-(?:proj-|ant-|live-|test-)?)([A-Za-z0-9_-]{16,})/g },
    { name: "GitHub token", pattern: /(gh[pousr]_|github_pat_)([A-Za-z0-9_]{20,})/g },
    { name: "Slack token", pattern: /(xox[abdeporsu]-)([A-Za-z0-9-]{10,})/g },
    { name: "AWS access key id", pattern: /(AKIA)([0-9A-Z]{16})\b/g },
    { name: "Google API key", pattern: /(AIza)([\w-]{30,})/g },
    { name: "JSON web token", pattern: /(eyJ)([\w-]{8,}\.[\w-]{8,}\.[\w-]+)/g },
];
/**
 * A value that is only a reference to a secret — `$TOKEN`, `${TOKEN}`,
 * `%TOKEN%`, `$(pass show …)`. Nothing is exposed by sending it, and the
 * judge reads the command more easily with the name left in.
 */
function isReference(value) {
    return /^(?:\$\{?\w+\}?|%\w+%|\$\(.*\))$/.test(value);
}
/** The same text with credential values replaced by `[redacted]`. */
export function redactSecrets(text) {
    return RULES.reduce((redacted, rule) => redacted.replace(rule.pattern, (match, keep, secret) => isReference(secret) ? match : keep + REDACTED), text);
}
