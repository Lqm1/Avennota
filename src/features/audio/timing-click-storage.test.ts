import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("クリック音の保存", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", new IDBFactory());
  });
  afterEach(async () => {
    const { timingClickCollection } = await import("./timing-click-storage");
    const collection = await timingClickCollection();
    await collection.cleanup();
    const { openLocalDatabase } = await import("../../platform/storage");
    const db = await openLocalDatabase();
    db.close();
    vi.unstubAllGlobals();
  });

  it("クリック音のバイナリを保存・更新して起動後に読み戻し、削除できる", async () => {
    const { timingClickCollection } = await import("./timing-click-storage");
    const collection = await timingClickCollection();
    await collection
      .insert({ id: "timing-click", bytes: new Uint8Array([1, 2]).buffer })
      .when("settled");
    await collection
      .update("timing-click", (clip) => {
        clip.bytes = new Uint8Array([3, 4]).buffer;
      })
      .when("settled");
    await collection.cleanup();
    const { openLocalDatabase } = await import("../../platform/storage");
    const db = await openLocalDatabase();
    db.close();
    vi.resetModules();
    const reopened = await import("./timing-click-storage");
    const restored = await reopened.timingClickCollection();
    expect(restored.get("timing-click")?.bytes).toStrictEqual(
      new Uint8Array([3, 4]).buffer
    );
    await restored.delete("timing-click").when("settled");
    await expect(restored.utils.exportData()).resolves.toStrictEqual([]);
  });
});
