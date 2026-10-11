/* eslint-disable no-await-in-loop -- Verify each completed opening in chronological order. */
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceFolder } from "../../platform/files";

vi.mock(import("@tauri-apps/api/core"), () => ({ isTauri: () => true }));

const folder = (name: string): VoiceFolder => ({
  name,
  bookmark: `D:/音源/${name}`,
  listFiles: async () => await Promise.resolve([]),
  read: async () => await Promise.resolve(new Uint8Array()),
  stat: async () => await Promise.resolve(null),
  write: async () => {
    await Promise.resolve();
  },
  ensureWritable: async () => await Promise.resolve(true),
});

describe("フォルダ履歴の保存", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", new IDBFactory());
  });
  afterEach(async () => {
    const { folderHistoryCollection } =
      await import("./folder-history-storage");
    const collection = await folderHistoryCollection();
    await collection.cleanup();
    const { openLocalDatabase } = await import("../../platform/storage");
    const db = await openLocalDatabase();
    db.close();
    vi.unstubAllGlobals();
  });

  it("最近開いた順で最大20件を保存し、開き直したフォルダを重複させない", async () => {
    const history = await import("./folder-history");
    for (let index = 0; index < 22; index += 1) {
      await history.rememberFolder(folder(`${index}`));
    }
    await history.rememberFolder(folder("10"));
    expect(history.folderHistoryStore.state).toHaveLength(20);
    expect(history.folderHistoryStore.state[0]?.name).toBe("10");
    expect(
      history.folderHistoryStore.state.filter((entry) => entry.name === "10")
    ).toHaveLength(1);
    const { folderHistoryCollection } =
      await import("./folder-history-storage");
    const collection = await folderHistoryCollection();
    await collection.cleanup();
    const { openLocalDatabase } = await import("../../platform/storage");
    const db = await openLocalDatabase();
    db.close();
    vi.resetModules();
    const reopened = await import("./folder-history");
    await reopened.loadFolderHistory();
    expect(reopened.folderHistoryStore.state).toStrictEqual(
      history.folderHistoryStore.state
    );
  });

  it("保存に失敗した履歴を画面へ反映せず、以前の履歴を保持する", async () => {
    const history = await import("./folder-history");
    await history.rememberFolder(folder("以前"));
    const { folderHistoryCollection } =
      await import("./folder-history-storage");
    const collection = await folderHistoryCollection();
    vi.spyOn(collection.utils, "importData").mockRejectedValueOnce(
      new Error("書き込み失敗")
    );
    await expect(history.rememberFolder(folder("失敗"))).rejects.toThrow(
      "書き込み失敗"
    );
    expect(
      history.folderHistoryStore.state.map((entry) => entry.name)
    ).toStrictEqual(["以前"]);
    await history.loadFolderHistory();
    expect(
      history.folderHistoryStore.state.map((entry) => entry.name)
    ).toStrictEqual(["以前"]);
  });
});
