import { createCollection, indexedDBCollectionOptions } from "@tanstack/db";
import { z } from "zod";

import { openLocalDatabase } from "../../platform/storage";
import { folderBookmarkSchema } from "./folder-bookmark";

export const isDirectoryHandle = (
  value: unknown
): value is FileSystemDirectoryHandle =>
  typeof FileSystemDirectoryHandle !== "undefined" &&
  value instanceof FileSystemDirectoryHandle;

const historyRowSchema = folderBookmarkSchema.extend({
  position: z.number().int().nonnegative(),
  handle: z.custom<FileSystemDirectoryHandle>(isDirectoryHandle).nullable(),
});
export type FolderHistoryRow = z.output<typeof historyRowSchema>;

const openHistory = async () => {
  const db = await openLocalDatabase();
  const collection = createCollection(
    indexedDBCollectionOptions({
      id: "folder-history",
      db,
      name: "folders",
      schema: historyRowSchema,
      getKey: (row) => row.id,
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

let history: ReturnType<typeof openHistory> | undefined;
export const folderHistoryCollection = async () => {
  history ??= openHistory();
  try {
    return await history;
  } catch (error) {
    history = undefined;
    throw error;
  }
};

export const readFolderHistory = async (): Promise<FolderHistoryRow[]> => {
  const collection = await folderHistoryCollection();
  return z
    .array(historyRowSchema)
    .parse([...collection.values()])
    .toSorted((left, right) => left.position - right.position);
};
