import { createCollection, indexedDBCollectionOptions } from "@tanstack/db";
import { z } from "zod";

import { recoveryRecordSchema } from "../../features/editor/recovery-data";
import { openLocalDatabase } from "../storage";
import type { FilePlatform, RecoveryStore, VoiceFolder } from "./types";
import { FileAccessError, toFileAccessError } from "./types";

/** フォルダとFile System Access APIのハンドルの対応。ハンドルは編集ロジックへ渡さない。 */
const handles = new WeakMap<VoiceFolder, FileSystemDirectoryHandle>();
const selectedFiles = new WeakMap<
  VoiceFolder,
  Map<string, FileSystemFileHandle>
>();
export const browserHandle = (
  folder: VoiceFolder
): FileSystemDirectoryHandle | undefined => handles.get(folder);
export const browserIniHandles = (
  folder: VoiceFolder
): FileSystemFileHandle[] => [...(selectedFiles.get(folder)?.values() ?? [])];

const readFile = async (
  directory: FileSystemDirectoryHandle,
  name: string,
  selected: ReadonlyMap<string, FileSystemFileHandle>
): Promise<File> => {
  const fileHandle =
    selected.get(name) ?? (await directory.getFileHandle(name));
  return await fileHandle.getFile();
};

/** 利用者が選んだフォルダを直接扱う。音源をブラウザ内へ複製しない。 */
export const createBrowserFolder = (
  directory: FileSystemDirectoryHandle,
  iniFiles: FileSystemFileHandle[] = []
): VoiceFolder => {
  const selected = new Map(iniFiles.map((handle) => [handle.name, handle]));
  const folder: VoiceFolder = {
    async pickIni() {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: "原音設定",
              accept: { "application/octet-stream": [".ini"] },
            },
          ],
        });
        if (handle === undefined) {
          return null;
        }
        const path = await directory.resolve(handle);
        if (path?.length !== 1 || !handle.name.toLowerCase().endsWith(".ini")) {
          throw new FileAccessError(
            "read",
            "選んだ音源フォルダの直下にあるiniファイルを選んでください。"
          );
        }
        if (
          (await handle.requestPermission({ mode: "readwrite" })) !== "granted"
        ) {
          throw new FileAccessError(
            "permission",
            "iniファイルへの書き込みが許可されていません。"
          );
        }
        selected.set(handle.name, handle);
        return handle.name;
      } catch (error) {
        throw toFileAccessError(error, "read", "iniファイルの選択");
      }
    },
    readRange: async (name, offset, length) => {
      const file = await readFile(directory, name, selected);
      return new Uint8Array(
        await file.slice(offset, offset + length).arrayBuffer()
      );
    },
    remove: async (name) => {
      await directory.removeEntry(name);
    },
    async ensureWritable() {
      const descriptor = { mode: "readwrite" } as const;
      if ((await directory.queryPermission(descriptor)) === "granted") {
        return true;
      }
      return (await directory.requestPermission(descriptor)) === "granted";
    },
    async listFiles() {
      try {
        const names: string[] = [];
        for await (const entry of directory.values()) {
          if (entry.kind === "file") {
            names.push(entry.name);
          }
        }
        return [...new Set([...names, ...selected.keys()])];
      } catch (error) {
        throw toFileAccessError(error, "read", "フォルダの読み込み");
      }
    },
    name: directory.name,
    async read(name) {
      try {
        const file = await readFile(directory, name, selected);
        return new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        throw toFileAccessError(error, "read", `${name}の読み込み`);
      }
    },
    async stat(name) {
      try {
        const file = await readFile(directory, name, selected);
        return { modifiedAt: file.lastModified, size: file.size };
      } catch (error) {
        const converted = toFileAccessError(error, "read", `${name}の確認`);
        if (converted.kind === "not-found") {
          return null;
        }
        throw converted;
      }
    },
    async write(name, bytes) {
      let writable: FileSystemWritableFileStream | null = null;
      try {
        const fileHandle =
          selected.get(name) ??
          (await directory.getFileHandle(name, {
            create: true,
          }));
        writable = await fileHandle.createWritable();
        await writable.write(bytes);
        // closeが解決した時点でブラウザが一時ファイルを元ファイルへ反映する。
        await writable.close();
      } catch (error) {
        if (writable) {
          try {
            await writable.abort();
          } catch {
            // 中断できなくても、元の失敗を報告する。
          }
        }
        throw toFileAccessError(error, "write", `${name}の書き込み`);
      }
    },
  };
  handles.set(folder, directory);
  selectedFiles.set(folder, selected);
  return folder;
};

const handleOf = (folder: VoiceFolder): FileSystemDirectoryHandle => {
  const handle = handles.get(folder);
  if (!handle) {
    throw new FileAccessError(
      "unsupported",
      "ブラウザで選んだフォルダではありません。"
    );
  }
  return handle;
};

const storedRecordSchema = recoveryRecordSchema.extend({
  iniFiles: z
    .array(
      z.custom<FileSystemFileHandle>(
        (handle) =>
          typeof FileSystemFileHandle !== "undefined" &&
          handle instanceof FileSystemFileHandle
      )
    )
    .default([]),
  handle: z.custom<FileSystemDirectoryHandle>(
    (handle) =>
      typeof FileSystemDirectoryHandle !== "undefined" &&
      handle instanceof FileSystemDirectoryHandle
  ),
});
type StoredRecord = z.output<typeof storedRecordSchema>;

const openRecovery = async () => {
  const collection = createCollection(
    indexedDBCollectionOptions({
      id: "browser-recovery",
      db: await openLocalDatabase(),
      name: "recovery",
      schema: storedRecordSchema,
      getKey: (record) => record.id,
      gcTime: Infinity,
    })
  );
  try {
    await collection.preload();
    return collection;
  } catch (error) {
    await collection.cleanup();
    throw error;
  }
};
let recovery: ReturnType<typeof openRecovery> | undefined;
const recoveryCollection = async () => {
  recovery ??= openRecovery();
  try {
    return await recovery;
  } catch (error) {
    recovery = undefined;
    throw error;
  }
};

const loadRecords = async (): Promise<StoredRecord[]> => {
  const collection = await recoveryCollection();
  return z.array(storedRecordSchema).parse([...collection.values()]);
};
/** 復元データはIndexedDBへ保存する。フォルダのハンドルも一緒に保存し、再起動後のアクセス再開に使う。 */
const createBrowserRecoveryStore = (): RecoveryStore => ({
  async idFor(folder) {
    const handle = handleOf(folder);
    const stored = await loadRecords();
    const matches = await Promise.all(
      stored.map(async (value) => await value.handle.isSameEntry(handle))
    );
    const index = matches.indexOf(true);
    return stored[index]?.id ?? crypto.randomUUID();
  },
  async list() {
    return await loadRecords();
  },
  async remove(id) {
    const collection = await recoveryCollection();
    if (collection.has(id)) {
      await collection.delete(id).when("settled");
    }
  },
  async reopen(id) {
    const collection = await recoveryCollection();
    const value = collection.get(id);
    if (value === undefined) {
      return null;
    }
    const stored = storedRecordSchema.parse(value);
    const folder = createBrowserFolder(stored.handle, stored.iniFiles);
    try {
      return (await folder.ensureWritable()) ? folder : null;
    } catch {
      return null;
    }
  },
  async save(folder, record) {
    const stored: StoredRecord = {
      ...record,
      handle: handleOf(folder),
      iniFiles: browserIniHandles(folder),
    };
    try {
      const collection = await recoveryCollection();
      // updateの下書きはネイティブのハンドルを通常のオブジェクトへ複製するため、IndexedDBへそのまま渡す。
      await collection.utils.importData([
        ...[...collection.values()].filter((value) => value.id !== record.id),
        stored,
      ]);
    } catch (error) {
      throw new FileAccessError(
        "write",
        `復元データを保存できません: ${String(error)}`,
        { cause: error }
      );
    }
  },
});

export const createBrowserPlatform = (): FilePlatform => ({
  kind: "browser",
  async pickFolder() {
    if (typeof window.showDirectoryPicker !== "function") {
      throw new FileAccessError(
        "unsupported",
        "このブラウザはフォルダを直接編集するFile System Access APIに対応していません。デスクトップ版のChromeまたはEdgeを使ってください。"
      );
    }
    try {
      const handle = await window.showDirectoryPicker({
        id: "avennota-voicebank",
        mode: "readwrite",
      });
      return createBrowserFolder(handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      throw toFileAccessError(error, "read", "フォルダの選択");
    }
  },
  recovery: createBrowserRecoveryStore(),
});
