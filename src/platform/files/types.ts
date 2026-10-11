import type { RecoveryRecord } from "../../features/editor/recovery-data";
/**
 * 編集ロジックが使うファイル操作。選択フォルダからの相対名だけを扱い、絶対パスやブラウザのハンドルを外へ出さない。
 */
export interface FileStat {
  size: number;
  /** 最終更新時刻（ミリ秒）。取得できない環境ではnull。 */
  modifiedAt: number | null;
}

export interface VoiceFolder {
  readRange?: (
    name: string,
    offset: number,
    length: number
  ) => Promise<Uint8Array<ArrayBuffer>>;
  remove?: (name: string) => Promise<void>;
  openInManager?: () => Promise<void>;
  parent?: () => Promise<VoiceFolder | null>;
  bookmark?: string;
  /** 画面表示用のフォルダ名。 */
  readonly name: string;
  /** 直下のファイル名の一覧。 */
  listFiles: () => Promise<string[]>;
  /** ファイルを読む。存在しない場合はFileAccessError（not-found）。 */
  read: (name: string) => Promise<Uint8Array<ArrayBuffer>>;
  /** ファイルの情報。存在しない場合はnull。 */
  stat: (name: string) => Promise<FileStat | null>;
  /**
   * ファイルを書く。書き込みの完了を確認してから解決する。
   * ネイティブ版は一時ファイルからの置き換え、ブラウザ版は書き込みストリームの終了で完了とする。
   */
  write: (name: string, bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
  /** 書き込み権限を確認し、必要なら利用者に許可を求める。 */
  ensureWritable: () => Promise<boolean>;
}

export type FileAccessErrorKind =
  | "permission"
  | "not-found"
  | "read"
  | "write"
  | "unsupported"
  | "cancelled";

export class FileAccessError extends Error {
  readonly kind: FileAccessErrorKind;

  constructor(
    kind: FileAccessErrorKind,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "FileAccessError";
    this.kind = kind;
  }
}

/** 復元データの保存先。元ファイルとは別に、編集中の内容を自動記録する。 */
export interface RecoveryStore {
  /** フォルダに対応する識別子を返す。同じフォルダを開き直したときは同じ値になる。 */
  idFor: (folder: VoiceFolder) => Promise<string>;
  save: (folder: VoiceFolder, record: RecoveryRecord) => Promise<void>;
  list: () => Promise<RecoveryRecord[]>;
  remove: (id: string) => Promise<void>;
  /**
   * 記録したフォルダへのアクセスを取り戻す。ブラウザでは利用者の操作中に呼ぶ必要がある。
   * 取り戻せない場合はnullを返し、呼び出し側がフォルダの再選択を求める。
   */
  reopen: (id: string) => Promise<VoiceFolder | null>;
}

export interface FilePlatform {
  readonly kind: "browser" | "native";
  /** フォルダを選ばせる。キャンセルされたらnull。 */
  pickFolder: () => Promise<VoiceFolder | null>;
  readonly recovery: RecoveryStore;
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 各環境の例外を、画面で扱える種類へ分類する。 */
export const toFileAccessError = (
  error: unknown,
  fallback: FileAccessErrorKind,
  action: string
): FileAccessError => {
  if (error instanceof FileAccessError) {
    return error;
  }
  const message = describe(error);
  const name = error instanceof Error ? error.name : "";
  if (
    name === "NotAllowedError" ||
    name === "SecurityError" ||
    /forbidden|not allowed|permission|denied|アクセスが拒否/iu.test(message)
  ) {
    return new FileAccessError(
      "permission",
      `${action}の権限がありません: ${message}`,
      { cause: error }
    );
  }
  if (
    name === "NotFoundError" ||
    /os error 2\b|not found|cannot find|見つかりません/iu.test(message)
  ) {
    return new FileAccessError(
      "not-found",
      `${action}の対象が見つかりません: ${message}`,
      { cause: error }
    );
  }
  if (name === "AbortError") {
    return new FileAccessError("cancelled", `${action}が中断されました`, {
      cause: error,
    });
  }
  if (
    name === "NoModificationAllowedError" ||
    /read-?only|読み取り専用/iu.test(message)
  ) {
    return new FileAccessError(
      "write",
      `${action}できません（読み取り専用）: ${message}`,
      { cause: error }
    );
  }
  return new FileAccessError(fallback, `${action}に失敗しました: ${message}`, {
    cause: error,
  });
};

export type { RecoveryRecord } from "../../features/editor/recovery-data";
