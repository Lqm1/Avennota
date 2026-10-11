# SHIRO自動ラベリング（後続）

SHIROによる自動ラベリングは初版に含めない。shiro-rsをWASM化した`@shiro-rs/wasm`を使い、Web側からブラウザとTauriのWebViewで共通に呼び出す。

- [shiro-rs](https://github.com/Lqm1/shiro-rs)
- [@shiro-rs/wasm](https://www.npmjs.com/package/@shiro-rs/wasm)
- [仮の日本語モデル](https://github.com/intunist/SHIRO-Models-Japanese)。後でユーザー自身のモデルに差し替える。

## 前提

- shiro-rsと`@shiro-rs/wasm`のライセンスはGPL-3.0-or-later。仮モデルのライセンス表記は見つかっていない。
- `@shiro-rs/wasm`のweb入口は初期化が必要。
- 処理は16kHzのMFCC抽出、音素列からの区間生成、HSMMによるアラインメント、ラベル出力。音声とモデルのほかにphonemapと音素列が要る。
- 音素境界の推定結果は、そのままではUTAUの原音設定値にならない。

## 統合前に決めること

1. 録音リスト・エイリアスなどから対象の音素列を作る方法。
2. アラインメント結果を左右ブランク・固定範囲・先行発声・オーバーラップへ変換する方法。
3. モデルの取得・キャッシュ・選択・差し替えと、オフライン時の入手元。
4. 進捗・キャンセル・エラーの扱いと、結果を手動編集へ反映する単位（Undoできること）。
5. コードとモデルの配布条件、アプリの公開ライセンス。
6. ViteとTauriでのWASMアセットの配置とWorkerからの利用。

統合に着手するまで、自動ラベリング用の抽象化やダミー実装を置かない。
