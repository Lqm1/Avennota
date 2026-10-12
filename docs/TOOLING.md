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
| `bun run tauri build` | 実行OSの配布物を作成（Windows: NSIS・exe、macOS: app・DMG、Linux: deb・AppImage） |
| `bun run typecheck` | 全体の型チェック |
| `bun run test` | Vitest |
| `bun run check` | 全体の品質検査（`ultracite check`） |
| `bun run fix` | 全体の自動修正（`ultracite fix`） |

## Gitフック

Huskyの`pre-commit`からlint-stagedを起動し、ステージ済みファイルへ`ultracite fix`を適用する。全体の品質検査・型チェック・テストの代わりにはならない。フックは`bun install`の`prepare`（`husky`）で有効になる。

## ネイティブ版の開発環境

- Windows: Visual StudioのC++ビルドツール、Rust、WebView2 Runtime。
- Windows ARM64はVisual StudioのC++ ARM64ビルドツールと`aarch64-pc-windows-msvc`、Windows x86は`i686-pc-windows-msvc`を追加する。ビルドは`bun run tauri build --target <ターゲット> -- --locked`。
- macOS: Xcode Command Line Tools（`xcode-select --install`）、Rust。
- Linux: RustとWebKitGTK 4.1の開発ライブラリ。Ubuntu 22.04では`sudo apt-get install libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf libfuse2`でビルド・AppImage用の依存を入れる。
- 全OSでNode.js・Bunを使い、同じ開発・ビルドコマンドを実行する。
- Linux x86のCIはDockerの`debian:bookworm`を`--platform linux/386`で使う。フロントエンドのビルドはx64ホストで行う。
- GitHub Actionsは`master`へのpush・pull request・手動実行で、Windows 3ターゲット・macOS Universal・Linux 3ターゲットをビルドする。生成物はターゲット別のartifactとして保持する。

## 自動リリース

- `master`へConventional Commitを追加すると、Release PleaseがリリースPRを作成・更新する。`feat:`はminor、`fix:`はpatch、`!`または`BREAKING CHANGE:`を含む変更はmajorを上げる。1.0未満の破壊的変更はminorを上げる。PRをsquash mergeする場合はPRタイトルをConventional Commitにする。
- 初回の公開バージョンは0.1.0。リリースPRは`package.json`・`src-tauri/tauri.conf.json`・`src-tauri/Cargo.toml`・`src-tauri/Cargo.lock`・`.release-please-manifest.json`のバージョンと、`CHANGELOG.md`を更新する。npm・crates.ioへの公開は行わない。
- リリースPRをマージすると、タグ`v<バージョン>`と下書きリリースを作成する。`release.yml`から`desktop.yml`を呼び、タグを指定して品質検査・テストとTauri公式`tauri-action`による配布ビルドを行う。
- 全OSのビルドとartifact保存が成功した後、配布物を下書きへアップロードして自動公開する。ビルドやアップロードが失敗した場合は下書きのまま残す。
- Windowsポータブルexeは`--no-bundle`で先にビルドし、NSISの種類情報が付く前のexeを保存する。
- 失敗時はActionsの該当する`Release`実行で「Re-run failed jobs」を選ぶ。
- GitHubのSettings → Actions → General → Workflow permissionsで「Allow GitHub Actions to create and approve pull requests」を有効にする。認証は標準の`GITHUB_TOKEN`を使い、追加のsecretは不要。
- `GITHUB_TOKEN`が作ったリリースPR・タグでは別のワークフローが起動しない。品質検査と公開用のビルドは、リリースPRのマージ後に同じReleaseワークフロー内から呼ぶ。

## TanStack Intent

`@tanstack/intent`は開発依存に入れ、スクリプトを置かずに`bunx @tanstack/intent@latest list`・`load`で実行する。`node_modules/.bin/intent`は`@tanstack/devtools-event-client`が同梱する古い`intent`に上書きされているため使えない。`intent install`を再実行すると、AGENTS.md先頭のブロックのコマンドが`bunx --no-install --package @tanstack/intent intent`形式に戻るので、`bunx @tanstack/intent@latest`へ直す。
