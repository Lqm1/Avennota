<!-- intent-skills:start -->

## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement. `node_modules/.bin/intent` is shadowed by a stale shim from `@tanstack/devtools-event-client`, so run Intent through `bunx @tanstack/intent@latest` as the official consumer guide shows. Before editing files for a substantial task:

- Run `bunx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->

# Avennota

UTAU音源の原音設定エディター。Web版とWindows版（Tauri）で同じ編集処理を使う。

## 資料

- `docs/SPEC.md`: 初版の要件の正本。作業前に読む。原音設定の用語は`GLOSSARY.md`に合わせる。
- `docs/EDITOR-FEATURES.md`・`docs/EDITOR-INTERACTIONS.md`: 機能、キー・マウス操作、メニュー。画面や操作を変えるときに読む。
- `docs/IMPLEMENTATION.md`: ディレクトリ、採用パッケージ、oto.ini・保存・描画負荷の扱い。コードを変えるときに読む。
- `docs/ACCEPTANCE.md`: 受け入れ条件と未確認の項目。ファイル・保存・復元を変えるときに読む。
- `docs/TOOLING.md`: コマンドの役割、Gitフック、TanStack Intent。
- `docs/SHIRO.md`: 後続の自動ラベリング。初版の範囲に含めない。

## 実装上の制約

- リリース前の開発期間は内部の保存形式・APIの下位互換性を維持しない。仕様変更時は旧形式の変換・移行・互換分岐と対応テストを残さず、現行仕様へ整理する。既存音源のoto.iniや文字コードへの対応は製品要件として維持する。汎用基盤や将来用コードを増やさず、必要なコードだけに絞る。
- Bunはパッケージマネージャーとスクリプト実行だけに使い、Bunのランタイム機能へ依存しない。テストはVitest。品質ツールはUltraciteのOxc構成（Oxlint + Oxfmt）、GitフックはHusky + lint-staged。
- 自作コードを減らし、知名度のあるパッケージを使う。同じ用途のTanStackパッケージがあれば優先する。ヘッドレスUI部品（React Aria）を積極的に使い、クラスの結合は`cn`を使う。無名に近いパッケージは避ける。
- 原音設定値などの名前は元のソフトウェアに合わせる（OpenUTAUの`Oto`／`OtoSet`。対応は`GLOSSARY.md`）。
- Tauri + React + Vite + TanStack Routerを使う。スタック変更はユーザーと相談する。
- React AriaとTailwind CSSを使い、UIの見た目は自作する。完成済みUIコンポーネントライブラリは導入しない。
- スタイルは原則としてコンポーネント内のTailwindクラス。グローバルCSSは読み込みと少数のテーマ定義に限定する。
- 音声処理・原音設定処理は基本的にWeb側で共有する。Rustはプラグイン初期化、権限設定などWeb公開に影響しないネイティブ専用処理に限定する。
- TanStack Routerはファイルベースルートを使い、Tauriの`src-tauri/`構造を維持する。
- 初版は原音設定エディター。独自プロジェクトファイルの作成を開始条件にしない。
- 既存Windowsプラグインの実行互換とエミュレーターは現状不要。

## ドキュメントの更新

仕様や実装が変わったら、該当する資料の記述を現在の内容へ書き換える。資料には決まっていることだけを端的に書く。変更履歴、経緯、判断の理由、検証の記録、日付、完了した作業の報告はコミットメッセージに残し、資料には書かない。未確認の項目は`docs/ACCEPTANCE.md`、未決定事項は`docs/SPEC.md`にだけ置き、解消したら消す。

## ドキュメント調査

ライブラリ、SDK、API、CLIの使用方法・構成・移行・ライブラリ固有の不具合を調べるときはContext7を使う。最初にresolve-library-idで正式なIDを選び、query-docsに具体的な質問を渡す。一般的な設計、業務ロジック、レビューには不要。Mintlify Indexはサービス終了済みのため使わない。

## 作業範囲

このプロジェクトは`D:\Desktop\Projects\Avennota`で、独立したGitリポジトリ。親ディレクトリ`D:\Desktop\Projects`も別のGitリポジトリなので、Git操作はこのリポジトリの中で行う。公開先は未決定。
