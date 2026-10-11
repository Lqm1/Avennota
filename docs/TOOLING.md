# 開発ツール

- Bunはパッケージマネージャーとスクリプト実行だけに使う。依存は`bun.lock`（JS）と`src-tauri/Cargo.lock`（Rust）で固定する。
- テストはVitest、型チェックは`tsc`。
- 品質ツールはUltraciteのOxc構成（Oxlint + Oxfmt）。React・TanStack・Vitest向けの規則を使う。`src/routeTree.gen.ts`、`src-tauri/target`、`src-tauri/gen`は対象外。

## コマンド

| コマンド | 役割 |
| --- | --- |
| `bun install --frozen-lockfile` | `bun.lock`どおりに依存を入れる |
| `bun run dev` | Vite開発サーバー（Web版、`http://localhost:1420`）。Tauriの`beforeDevCommand` |
| `bun run tauri dev` | ネイティブ版の開発起動 |
| `bun run build` | 型チェックとViteの本番ビルド（`dist/`）。Tauriの`beforeBuildCommand` |
| `bun run tauri build` | NSISインストーラーとexeの作成 |
| `bun run typecheck` | 全体の型チェック |
| `bun run test` | Vitest |
| `bun run check` | 全体の品質検査（`ultracite check`） |
| `bun run fix` | 全体の自動修正（`ultracite fix`） |

## Gitフック

Huskyの`pre-commit`からlint-stagedを起動し、ステージ済みファイルへ`ultracite fix`を適用する。全体の品質検査・型チェック・テストの代わりにはならない。フックは`bun install`の`prepare`（`husky`）で有効になる。

## TanStack Intent

`@tanstack/intent`は開発依存に入れ、スクリプトを置かずに`bunx @tanstack/intent@latest list`・`load`で実行する。`node_modules/.bin/intent`は`@tanstack/devtools-event-client`が同梱する古い`intent`に上書きされているため使えない。`intent install`を再実行すると、AGENTS.md先頭のブロックのコマンドが`bunx --no-install --package @tanstack/intent intent`形式に戻るので、`bunx @tanstack/intent@latest`へ直す。
