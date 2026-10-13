import { isTauri } from "@tauri-apps/api/core";

import type { FilePlatform } from "./types";

export type {
  FilePlatform,
  FileStat,
  RecoveryRecord,
  VoiceFolder,
} from "./types";
export { errorText, FileAccessError } from "./types";

const loadPlatform = async (): Promise<FilePlatform> => {
  if (isTauri()) {
    const { createNativePlatform } = await import("./tauri");
    return createNativePlatform();
  }
  const { createBrowserPlatform } = await import("./browser");
  return createBrowserPlatform();
};

let platform: Promise<FilePlatform> | null = null;

/**
 * 実行環境に合ったファイル操作を読み込む。Web版はTauriのプラグインを読み込まず、起動時にTauri APIを呼ばない。
 */
export const getFilePlatform = async (): Promise<FilePlatform> => {
  platform ??= loadPlatform();
  return await platform;
};

/** ブラウザで必要なAPIがない場合の案内文。対応していればnull。 */
export const unsupportedReason = (): string | null => {
  if (isTauri()) {
    return null;
  }
  if (typeof window.showDirectoryPicker !== "function") {
    return "お使いのブラウザはフォルダを直接編集する機能（File System Access API）に対応していません。デスクトップ版のGoogle ChromeやMicrosoft Edgeをご利用いただくか、デスクトップアプリ版をご利用ください。";
  }
  if (!window.isSecureContext) {
    return "フォルダの編集にはセキュアな接続（HTTPS環境）が必要です。";
  }
  return null;
};
