# jev-use

[English](README.md) | [简体中文](README.zh-CN.md) | **日本語**

Claude Code、Codex、[pi](https://github.com/badlogic/pi-mono) が
[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) と協働するための最良の方法です。
テキスト出力を必要としないタスクを Jev に任せることで、ステップは速く、
トークンは少なく、タスクはより早く、より良く完了します。

LLM と Jev を真の協働者にします。コンテンツを書く必要があるときは
LLM が引き継ぎ、ステップに素早い判断だけが必要なときは Jev が
それを実行します。

## デモ — 実際の実行、等倍速

<table>
<tr>
<td width="50%" valign="top"><b>経路案内タスク：Jev がクリックし、LLM が入力する</b> — 10 回の判断（p50 274 ms）· 4 回の書き込み。Jev が誤ったルートを却下し、LLM が書き直します<br><img src="assets/collab.gif" alt="OpenStreetMap の経路案内：Jev が緑色でコントロールを選び、LLM が青色で地点を入力します。1809km という誤ったジオコードは Jev に却下されて LLM が修正し、最終的に実際の 3.7km の徒歩ルートが表示されます" width="100%"></td>
<td width="50%" valign="top"><b>コンテキストのコンパクション</b> — 200 件のメッセージを 7 回の呼び出しで判定し、LLM が書いた 1 段落が削除されたメッセージ群を置き換えます。想起テスト 3/3<br><img src="assets/compact.gif" alt="実際のトランスクリプトがコンテキストウィンドウを 94% まで埋めています。Jev が各メッセージを保持または削除に色分けし、LLM の要約段落が削除されたブロックを置き換えると、ウィンドウは 44% まで下がり、3 つの想起チェックに合格します" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top"><b>Pong：ボールの速さ = 判断のレイテンシ</b> — 20 秒間で Jev は 86 回判断したのに対し、通常の方法で呼び出した場合は 6 回（haiku）と 3 回（gemini）。両方を enum で制約した場合、差は 3 倍です<br><img src="assets/pong.gif" alt="ライブ実行を等倍速で再生する 3 つの Pong レーン：Jev のボールは 1 回の判断あたり約 224ms でフィールドを駆け抜け、LLM のボールはのろのろと進みます" width="100%"></td>
<td width="50%" valign="top"><b>すべてのシェルコマンドをゲートする</b> — 危険なコマンドは約 230 ms で理由付きで拒否され、LLM のトークン消費はゼロです<br><img src="assets/gate.gif" alt="24 個のコマンドからなる開発セッションを等倍速でゲート：危険なコマンドは確信度 1.00 で拒否され、無害なコマンドは許可されます" width="100%"></td>
</tr>
</table>

すべてのデモは [bench/examples/](bench/examples) にある再実行可能なスクリプトです。
すべての数値、方法論、ばらつき、注意事項は
[bench/RESULTS.md](bench/RESULTS.md)、第三者による計測は
[docs/evidence.md](docs/evidence.md) をご覧ください。

## インストール

```bash
npx -y jev-use install    # wires Claude Code, Codex, and pi — whichever it finds
```

エージェントが動作する環境で、キーを 1 つ設定します（キーなしで試すドライランには
`JEV_BACKEND=mock` を使います）：

| プロバイダー | 環境変数 |
| --- | --- |
| [TypeSafe direct](https://typesafe.ai/) | `TYPESAFE_API_KEY` |
| [OpenRouter](https://openrouter.ai/typesafe/jev-1.13) | `OPENROUTER_API_KEY` |
| [Vercel AI Gateway](https://vercel.com/ai-gateway/models/jev) | `AI_GATEWAY_API_KEY` |

`npx -y jev-use doctor` で接続設定を確認できます。判定対象の状態は、設定した
プロバイダーに送信されます。`JEV_BACKEND=mock` の場合はローカルにとどまります。ルーティングスキルと
PreToolUse ゲートを含むプラグイン形式：
[harness/claude-code](harness/claude-code/README.md) ·
[harness/codex](harness/codex/README.md)。

## ライブラリとして使う

`npm i jev-use` — 判定処理の経路にはランタイム依存関係がありません：

```js
import { Jev, check, pick, rate } from "jev-use";

const jev = new Jev();

const { answers } = await jev.judge(state, {
  next: pick("Next action?", { merge: "all green", rerun: "looks flaky", hold: "needs attention" }),
  risk: rate("How risky?", ["routine", "worth a look", "incident"]),
  passed: check("Did the run fully succeed?"),
});
// answers.next → { answer: "merge", confidence: 0.93, confidenceFrom: "reported", escalate: false }
```

Jev が判断できない、または判断すべきでないものは、`escalate: true`
と型付きの理由とともに返されます。ツール、判定結果の形式、エスカレーションの契約、CLI については
[docs/reference.md](docs/reference.md) をご覧ください。

## 読み切れるほど小さい

| ファイル | 役割 |
| --- | --- |
| [src/protocol.ts](src/protocol.ts) | 質問（`check`/`pick`/`rate`）、判定結果、エスカレーションの理由 |
| [src/dispatch.ts](src/dispatch.ts) | 呼び出し前のルーティング：Jev に届かないもの |
| [src/judge.ts](src/judge.ts) | スクリーニング → バックエンド → 不確かなものを差し戻す。`gate` |
| [src/jev.ts](src/jev.ts) | そのエンジンの上に構築された `Jev` クライアント |
| [src/redact.ts](src/redact.ts) | ゲート対象のアクションから、送信前に認証情報を取り除きます |
| [src/backends/](src/backends) | TypeSafe、OpenRouter、Vercel、mock のアダプター |
| [src/server.ts](src/server.ts) | 2 つの MCP ツール |
| [src/cli.ts](src/cli.ts) | `install`、`serve`、`hook gate`、`doctor` |
| [skills/jev-use/SKILL.md](skills/jev-use/SKILL.md) | エージェントが従うルーティングのルール |

## 開発

```console
$ npm run typecheck && npm test    # unit tests incl. per-provider wire fixtures
$ npm run smoke                    # real MCP client ↔ built CLI over stdio
$ node bench/run.mjs               # micro-benchmarks, your key and region
```

大部分は Claude Code を使って書かれています（AI 支援）。

MIT © [shitianfang](https://github.com/shitianfang)
