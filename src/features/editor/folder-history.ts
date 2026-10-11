/* eslint-disable no-await-in-loop -- Compare persistent handles in history order before choosing the matching entry. */
import { createStore, useSelector } from "@tanstack/react-store";
import { isTauri } from "@tauri-apps/api/core";

import type { VoiceFolder } from "../../platform/files";
import type { FolderBookmark } from "./folder-bookmark";
import {
  folderHistoryCollection,
  isDirectoryHandle,
  readFolderHistory,
} from "./folder-history-storage";
import type { FolderHistoryRow } from "./folder-history-storage";

export type { FolderBookmark } from "./folder-bookmark";

export const folderHistoryStore = createStore<FolderBookmark[]>([]);
export const useFolderHistory = () =>
  useSelector(folderHistoryStore, (state) => state);
const bookmark = ({
  id,
  name,
  nativePath,
}: FolderBookmark): FolderBookmark => ({
  id,
  name,
  nativePath,
});
export const loadFolderHistory = async (): Promise<void> => {
  const records = await readFolderHistory();
  folderHistoryStore.setState(() => records.map(bookmark));
};
export const rememberFolder = async (
  folder: VoiceFolder
): Promise<FolderBookmark | null> => {
  let id = folder.bookmark ?? "";
  let handle: FileSystemDirectoryHandle | null = null;
  if (!isTauri()) {
    const { browserHandle } = await import("../../platform/files/browser");
    handle = browserHandle(folder) ?? null;
    if (handle === null) {
      return null;
    }
  }
  const previous = await readFolderHistory();
  if (handle !== null) {
    for (const entry of previous) {
      const candidate = entry.handle;
      if (
        isDirectoryHandle(candidate) &&
        (await handle.isSameEntry(candidate))
      ) {
        ({ id } = entry);
        break;
      }
    }
    id ||= crypto.randomUUID();
  }
  const records: FolderHistoryRow[] = [
    { id, name: folder.name, nativePath: folder.bookmark ?? null, handle },
    ...previous.filter((entry) => entry.id !== id),
  ]
    .slice(0, 20)
    .map((entry, position) => ({ ...entry, position }));
  const collection = await folderHistoryCollection();
  await collection.utils.importData(records);
  folderHistoryStore.setState(() => records.map(bookmark));
  return { id, name: folder.name, nativePath: folder.bookmark ?? null };
};
export const reopenBookmark = async (
  entry: FolderBookmark
): Promise<VoiceFolder | null> => {
  if (isTauri() && entry.nativePath !== null) {
    const { createNativeFolder } = await import("../../platform/files/tauri");
    const folder = createNativeFolder(entry.nativePath);
    try {
      await folder.listFiles();
      return folder;
    } catch {
      return null;
    }
  }
  const collection = await folderHistoryCollection();
  const handle = collection.get(entry.id)?.handle;
  if (!isDirectoryHandle(handle)) {
    return null;
  }
  const descriptor = { mode: "readwrite" } as const;
  if (
    (await handle.queryPermission(descriptor)) !== "granted" &&
    (await handle.requestPermission(descriptor)) !== "granted"
  ) {
    return null;
  }
  const { createBrowserFolder } = await import("../../platform/files/browser");
  return createBrowserFolder(handle);
};
