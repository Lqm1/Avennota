# 実装の構成

## ディレクトリ

```text
src/
  routes/                 TanStack Routerのファイルベースルート（__root.tsx、index.tsx）。画面の入口だけを置く
  routeTree.gen.ts        生成ファイル
  features/
    oto/                  oto.iniの解釈・書き戻し・文字コード・マーカー計算（UIなし）
    editor/               編集状態、履歴、画面、ショートカット、設定、復元データ
    audio/                波形・解析パネル、WAVの読み込みと加工、再生
    alignment/            SHIROの音素境界推定、仮名解析、モデル取得、原音設定生成
  workers/                スペクトログラム、パワー・F0、SHIROのWorker
  platform/
    files/                フォルダ操作の共通APIとブラウザ版・ネイティブ版の実装
    storage.ts            共有IndexedDB
    window.ts             終了時の確認
  components/ui/          React Ariaを使った共通部品
src-tauri/                Tauri（fs・dialog・persisted-scopeプラグイン、WebView2の不足検出、ウィンドウ制御）
```

## 主なパッケージ

| 用途 | パッケージ | 備考 |
| --- | --- | --- |
| ルーティング | `@tanstack/react-router`、`@tanstack/router-plugin` | ファイルベースルート |
| 状態管理 | `@tanstack/react-store` | 適用中の設定、編集状態、Undo／Redo、WAVの長さ |
| ショートカット | `@tanstack/react-hotkeys` | 入力欄では単独キーを無視する |
| 間引き | `@tanstack/react-pacer` | 復元データの記録、ドラッグ中の仮の値 |
| 永続化 | `@tanstack/db` | 公式localStorage／IndexedDBアダプター |
| UI | `react-aria-components` | Table（Virtualizerで仮想化）、NumberField、Select、Dialogなど |
| 表示領域の分割 | `react-resizable-panels` | 音声パネル・一覧・詳細欄の大きさ |
| 波形・再生 | `wavesurfer.js`、`@wavesurfer/react` | Regions（マーカー）、Spectrogram、Timeline、Hover |
| 解析Worker通信 | `comlink` | 型付きRPC。音声バッファは転送する |
| F0 | `pitchy` | MPM |
| 自動原音設定 | `@shiro-rs/wasm` | MFCC・HMM・HSMMをWorkerで実行 |
| 文字コード | `encoding-japanese` | Shift_JISへの変換。読み込みはTextDecoder |
| 保存データの検証 | `zod` | 保存・読み込みの境界で検証する |
| スタイル | `tailwindcss`、`cn` | 色は`styles.css`の`@theme`トークン。幅に応じた表示はコンテナクエリ |
| アイコン | `lucide-react` | 名前を隠すボタンはツールチップと`aria-label`で名前を示す |

## 型と参照

- 編集状態は`Workspace`のclosed／openで分ける。Sessionと履歴はopenだけが持つ。
- 一覧の行は解釈済み／未解釈で分け、元の`OtoLine`を参照する。WAV名・エイリアス・原音設定値を表示用オブジェクトへ複製しない。波形と詳細欄も同じ行を使う。
- 行の元の文字列・バイト列・改行は`LineSource`にまとめる。新規行だけsourceがnull。欠けていた数値欄は存在する欄だけを保持し、編集で必要になった欄を補う。
- 値が変わらない編集・選択・Undo／Redoは元の状態を返す。変更時も未編集の行を再利用する。保存中に追加した編集は保存済みにしない。
- 一括処理は対象の行IDと元の`OtoSet`から`BatchResult`（元データ・結果・行ごとの処理）を作る。行ごとの追加・変更・削除・スキップ・エラーは`BatchBuilder`に記録する。検索条件は`RowQuery`、エイリアスの規則は`AliasRules`、音節表は`SyllableTable`が解釈済みの値と処理をまとめて持つ。`OtoSet`・行・結果は変更しないプレーンなオブジェクトのまま扱う。画面は結果を一覧表示してから`transformOtoSet`で1回の履歴として反映する。元データが変わっていれば反映しない。新しい行は元行の文字列から作り、数値の表記・追加欄・コメントを引き継ぐ。
- 一覧の絞り込み（USTと検索）は`row-filter.ts`の行IDの集合で、行移動・範囲選択・一括処理の「表示中の行」で共有する。
- 復元データとIndexedDBの値はストレージの境界で検証し、内部では検証済みの`RecoveryRecord`を使う。
- 音声の状態はloading／ready／errorで分ける。WAVの長さは`VoiceFolder`別に保持し、同名ファイルを混同しない。

## oto.ini

- バイト列をCR・LF・CRLFで行に分けてから文字コードを判定する（CRとLFはShift_JISの2バイト目に現れない）。
- 各行の元のバイト列と改行を保持し、文字列が変わっていない行はそのまま書き戻す。未編集なら保存結果は元ファイルとバイト一致する。
- 数値欄は元の表記（`375.0`など）を保ち、変更した欄だけを小数第3位までで書き直す。
- Shift_JISへ変換できない文字（読み戻すと別の文字になるものを含む）は保存前に行を示して止める。
- 文字コードの切り替えは未編集行を元のバイト列から読み直す。画面表示はIANA名`UTF-8`／`Shift_JIS`、内部の識別子は`utf-8`／`shift_jis`、encoding-japaneseへは`SJIS`を渡す。

## 時間軸とマーカー

- wavesurfer.jsは表示用に44.1kHzでデコードする。時間は秒で扱い、原音設定値（ミリ秒）とは`ms / 1000`で換算する。ファイルのサンプリング周波数とは独立に位置が一致する。
- 再生はWebAudioバックエンド。範囲再生は`play(start, end)`で、終了位置は描画フレーム単位で判定する。
- 右ブランクは負なら左ブランクからの長さ、0以上なら末尾からの距離。ドラッグやF5では元の符号の表現を保つ。
- 左ブランクを動かすと他のマーカーの絶対位置を保つ。連動モードでは先行発声と一緒に全マーカーが動く。

## 描画の負荷

React AriaのTableは行データが変わると全行のコレクションを組み直すため、1000行を超えるoto.iniではこれを避ける。

- ドラッグ中は編集状態を更新せず、仮の値（`markerPreviewStore`）だけを更新する。仮の値の更新はTanStack Pacerの`Throttler`で描画フレーム程度に間引く。離したときに1回だけ確定し、1回のドラッグを1つの履歴にする。確定前に仮の値を消さない。
- 一覧の行オブジェクトは、内容と表示条件が変わらなければ再利用する（`rows.ts`・`table-rows.ts`の`rowCache`）。選択・入力の変更では変わった行だけを更新する。
- 一覧は`memo`し、`useDeferredValue`で後回しにする。
- スペクトログラムの周波数ラベルはポインター操作を透過させ、マーカーのラベルはつかみ領域より手前に置く。

## 解析Worker

- スペクトログラムとパワー・F0は別々のモジュールWorkerで計算する。Comlinkの`expose`／`wrap`で関数を公開し、呼び出し側の型は公開関数から導出する。サンプル配列は`transfer`で渡し、解析例外は呼び出し側で捕捉する。
- Workerの生成・終了は表示側のEffectで管理し、破棄時にプロキシを解放して終了する。終了後や古い依頼の結果は反映しない。

## 保存

- 設定はTanStack DBのlocalStorageコレクションの`avennota.editor-settings`キー。自動保存と手動保存は順に処理し、失敗時は適用中の値を保って設定画面にエラーを表示する。別タブの保存値は作業中の設定へ適用しない。
- IndexedDBは`avennota`データベースを共有する。`folders`に最近使ったフォルダ20件、`recovery`にWebの復元データとフォルダ参照、`audio`にクリック音、`models`にSHIROの音響モデルとphonemapを置く。保存・削除はトランザクションの完了を待つ。
- 一括処理の抽出は音源フォルダの別iniへ`applyFileChanges`で書く。フォルダ経由のini書き込みが拒否されるブラウザでは保存ダイアログで作り、編集中のiniが選ばれたら読み込み時の内容へ戻して中止する。編集中のセッションと保存基準は変えない。
- oto.iniの保存手順: 入力中の値を確定 → 書き込み権限の確認 → 元ファイルを読み直して比較（外部変更なら確認）→ `oto.ini.bak`へ保存前の内容を書く → `oto.ini`を書く → 読み戻して照合 → 保存済みにする。
- ネイティブ版は同じフォルダの`oto.ini.avennota-tmp`へ書いてから置き換える。ブラウザ版は書き込みストリームの`close()`完了で書き込み完了とする。
- WindowsのChromium系ブラウザは`.ini`を危険なファイル種別として扱い、フォルダ経由の`getFileHandle`を拒否し、フォルダの一覧からも除く。そのためiniは`showOpenFilePicker`で選ぶか、`showSaveFilePicker`で作る。保存ダイアログは選んだ時点でファイルを作り、既存なら空にする。
- ブラウザで個別に選んだ・作ったiniは、`FileSystemFileHandle`を名前ごとに保持して読み込み・情報取得・書き込みに使う。`resolve`で音源フォルダ直下のファイルであることを確認する。ファイル参照はフォルダ履歴と復元データに保存する。
- 復元データは編集が止まって1秒後に記録する。ネイティブ版はアプリデータ領域の`recovery/*.json`。元ファイルのSHA-256を記録し、復元時に変わっていれば確認する。
- Webの復元データはIndexedDBコレクションの`importData`で置き換える。フォルダ参照を更新用draftに通さず、IndexedDBのstructured cloneで保存する。
- ネイティブ版はpersisted-scopeプラグインで前回選んだフォルダのスコープを保持する。
- ネイティブ版の復元IDは絶対パスのSHA-256から作り、大文字・小文字を保持する。大小文字を区別するファイルシステムの音源を混同しない。

## デスクトップのビルド

- 共通設定は`src-tauri/tauri.conf.json`。配布形式はTauriが自動で読み込む`tauri.windows.conf.json`・`tauri.macos.conf.json`・`tauri.linux.conf.json`へ分ける。
- Windowsはx64・ARM64・x86のNSIS・ポータブルexe、macOSはUniversal版のapp・DMG、Linuxはx64・ARM64・x86のdeb・AppImage。各CPU向けのツールチェーンでビルドする。
- macOSの最低バージョンは14。フロントエンドの構文はES2022を対象とし、`core-js`で`findLast`・`toReversed`・`toSorted`・`Promise.withResolvers`だけを補う。画面とSHIROのWorkerの両方で読み込む。
- `.github/workflows/desktop.yml`で7つのビルドを行い、ターゲット別のartifactへ生成物を保存する。Windowsはx64ランナーから3つのCPU向けにビルドし、Linux ARM64はUbuntu 22.04のARM64ランナーを使う。
- Linux x86はホストでフロントエンドをビルドした後、ワークフロー内でDebian 12の32bitコンテナーを起動する。RustとWebKitGTKなどをコンテナーに入れる。Tauri CLIはJS版と同じバージョンを使う。
- `release-please-config.json`はアプリ全体を1つのリリースとして扱い、Release Pleaseの`extra-files`でJS・Tauri・Rust・Cargo.lockのバージョンをそろえる。
- `.github/workflows/release.yml`はリリースPRのマージ後にタグのコミットを`desktop.yml`へ渡し、全配布物のビルド・アップロード完了後に下書きリリースを公開する。

## アイコン

元画像は`public/favicon.svg`だけで、Web版のファビコンを兼ねる。ネイティブ用は`bun run tauri icon public/favicon.svg -o <一時ディレクトリ>`で生成し、`tauri.conf.json`が参照する6ファイルだけを`src-tauri/icons`へ置く。

## 既知の制約

- wavesurfer.jsのスペクトログラムプラグインはNode.js向けの分岐を含み、Viteで`worker_threads`の外部化とチャンクサイズの警告が出る。ブラウザでは使われない。
- `@wavesurfer/react`はオプションが変わるとインスタンスを作り直す。
