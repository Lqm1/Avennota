/* eslint-disable no-await-in-loop -- Sequential reads advance the same open file cursor. */
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  writeFile,
  writeTextFile,
  open as openFile,
  SeekMode,
} from "@tauri-apps/plugin-fs";
import { z } from "zod";

import { recoveryRecordSchema } from "../../features/editor/recovery-data";
import type { FilePlatform, RecoveryStore, VoiceFolder } from "./types";
import { FileAccessError, toFileAccessError } from "./types";

/** フォルダと絶対パスの対応。絶対パスは編集ロジックへ渡さない。 */
const paths = new WeakMap<VoiceFolder, string>();

const removeQuietly = async (path: string): Promise<void> => {
  try {
    await remove(path);
  } catch {
    // 一時ファイルが残っても、元の失敗を報告する。
  }
};

/**
 * Tauriのfs・dialogプラグインで選択フォルダを扱う。アクセス範囲はdialogが実行時スコープへ追加したフォルダに限られる。
 */
export const createNativeFolder = (path: string): VoiceFolder => {
  const resolve = async (name: string) => await join(path, name);
  const folder: VoiceFolder = {
    readRange: async (name, offset, length) => {
      const file = await openFile(await resolve(name), { read: true });
      try {
        await file.seek(offset, SeekMode.Start);
        const bytes = new Uint8Array(length);
        let read = 0;
        while (read < length) {
          const amount = await file.read(bytes.subarray(read));
          if (amount === null || amount === 0) {
            break;
          }
          read += amount;
        }
        return bytes.slice(0, read);
      } finally {
        await file.close();
      }
    },
    bookmark: path,
    openInManager: async () => {
      await invoke("open_folder_manager", { path });
    },
    parent: async () =>
      createNativeFolder(await invoke<string>("open_parent_folder", { path })),
    remove: async (name) => {
      await remove(await resolve(name));
    },
    async ensureWritable() {
      await stat(path);
      return true;
    },
    async listFiles() {
      try {
        const entries = await readDir(path);
        return entries
          .filter((entry) => entry.isFile)
          .map((entry) => entry.name);
      } catch (error) {
        throw toFileAccessError(error, "read", "フォルダの読み込み");
      }
    },
    name: path.split(/[\\/]/u).findLast((part) => part !== "") ?? path,
    async read(name) {
      try {
        return await readFile(await resolve(name));
      } catch (error) {
        throw toFileAccessError(error, "read", `${name}の読み込み`);
      }
    },
    async stat(name) {
      try {
        const target = await resolve(name);
        if (!(await exists(target))) {
          return null;
        }
        const info = await stat(target);
        return { modifiedAt: info.mtime?.getTime() ?? null, size: info.size };
      } catch (error) {
        throw toFileAccessError(error, "read", `${name}の確認`);
      }
    },
    async write(name, bytes) {
      const target = await resolve(name);
      const temporary = await resolve(`${name}.avennota-tmp`);
      try {
        await writeFile(temporary, bytes);
        // 同じフォルダ内の一時ファイルで置き換えるため、書き込み途中の内容が元ファイルに残らない。
        await rename(temporary, target);
      } catch (error) {
        await removeQuietly(temporary);
        throw toFileAccessError(error, "write", `${name}の書き込み`);
      }
    },
  };
  paths.set(folder, path);
  return folder;
};

const pathOf = (folder: VoiceFolder): string => {
  const path = paths.get(folder);
  if (path === undefined) {
    throw new FileAccessError(
      "unsupported",
      "デスクトップ版で選んだフォルダではありません。"
    );
  }
  return path;
};

const RECOVERY_DIR = "recovery";
const appData = { baseDir: BaseDirectory.AppData };

export const nativeRecoveryId = async (path: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(path)
  );
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const storedRecordSchema = recoveryRecordSchema.extend({
  path: z.string().min(1),
});
type StoredRecord = z.output<typeof storedRecordSchema>;

const readRecord = async (fileName: string): Promise<StoredRecord> => {
  const text = await readTextFile(`${RECOVERY_DIR}/${fileName}`, appData);
  return storedRecordSchema.parse(JSON.parse(text));
};

/** 復元データはアプリデータ領域のrecoveryフォルダへJSONで保存する。 */
const createNativeRecoveryStore = (): RecoveryStore => ({
  idFor: async (folder) => await nativeRecoveryId(pathOf(folder)),
  async list() {
    if (!(await exists(RECOVERY_DIR, appData))) {
      return [];
    }
    const files = await readDir(RECOVERY_DIR, appData);
    return await Promise.all(
      files
        .filter((file) => file.isFile && file.name.endsWith(".json"))
        .map(async (file) => await readRecord(file.name))
    );
  },
  async remove(id) {
    const name = `${RECOVERY_DIR}/${id}.json`;
    if (await exists(name, appData)) {
      await remove(name, appData);
    }
  },
  async reopen(id) {
    const record = await readRecord(`${id}.json`);
    const folder = createNativeFolder(record.path);
    try {
      // persisted-scopeが前回のスコープを復元していれば読める。読めなければ再選択を求める。
      await folder.listFiles();
      return folder;
    } catch {
      return null;
    }
  },
  async save(folder, record) {
    const stored: StoredRecord = { ...record, path: pathOf(folder) };
    try {
      await mkdir(RECOVERY_DIR, { ...appData, recursive: true });
      const temporary = `${RECOVERY_DIR}/${record.id}.json.tmp`;
      await writeTextFile(temporary, JSON.stringify(stored), appData);
      await rename(temporary, `${RECOVERY_DIR}/${record.id}.json`, {
        newPathBaseDir: BaseDirectory.AppData,
        oldPathBaseDir: BaseDirectory.AppData,
      });
    } catch (error) {
      throw new FileAccessError(
        "write",
        `復元データを保存できません: ${String(error)}`,
        { cause: error }
      );
    }
  },
});

export const createNativePlatform = (): FilePlatform => ({
  kind: "native",
  async pickFolder() {
    try {
      const selected = await open({ directory: true, recursive: false });
      return selected === null ? null : createNativeFolder(selected);
    } catch (error) {
      throw toFileAccessError(error, "read", "フォルダの選択");
    }
  },
  recovery: createNativeRecoveryStore(),
});
