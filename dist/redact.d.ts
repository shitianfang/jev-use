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
export declare const REDACTED = "[redacted]";
/** The same text with credential values replaced by `[redacted]`. */
export declare function redactSecrets(text: string): string;
