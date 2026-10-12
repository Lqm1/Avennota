import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const phonemap = JSON.stringify({
  phone_map: { pau: { states: [{ dur: 0, out: [0, 0, 0] }] } },
});

describe("音響モデルの取得と保存", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", new IDBFactory());
  });
  afterEach(async () => {
    const { acousticModelCollection } = await import("./model-storage");
    const collection = await acousticModelCollection();
    await collection.cleanup();
    const { openLocalDatabase } = await import("../../platform/storage");
    const db = await openLocalDatabase();
    db.close();
    vi.unstubAllGlobals();
  });

  it("モデルとphonemapを保存し再起動後はネット接続なしで読み込む", async () => {
    const fetchModel = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(new Response(phonemap));
    vi.stubGlobal("fetch", fetchModel);
    const { loadJapaneseModel } = await import("./models");
    const model = await loadJapaneseModel(new AbortController().signal);
    expect(fetchModel).toHaveBeenCalledTimes(2);
    const { acousticModelCollection } = await import("./model-storage");
    const collection = await acousticModelCollection();
    await collection.cleanup();
    const { openLocalDatabase } = await import("../../platform/storage");
    const db = await openLocalDatabase();
    db.close();
    vi.resetModules();
    const offlineFetch = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", offlineFetch);
    const reopened = await import("./models");
    await expect(
      reopened.loadJapaneseModel(new AbortController().signal)
    ).resolves.toStrictEqual(model);
    expect(offlineFetch).not.toHaveBeenCalled();
  });

  it("片方の取得が失敗したときは不完全なモデルを保存しない", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<(url: string) => Promise<Response>>()
        .mockResolvedValueOnce(new Response(new Uint8Array([1])))
        .mockResolvedValueOnce(new Response("", { status: 503 }))
    );
    const { loadJapaneseModel } = await import("./models");
    await expect(
      loadJapaneseModel(new AbortController().signal)
    ).rejects.toThrow("503");
    const { acousticModelCollection } = await import("./model-storage");
    const collection = await acousticModelCollection();
    expect(collection.size).toBe(0);
  });

  it("キャンセル済みの依頼では取得しない", async () => {
    const download = vi.fn<() => Promise<Response>>();
    vi.stubGlobal("fetch", download);
    const abort = new AbortController();
    abort.abort();
    const { loadJapaneseModel } = await import("./models");
    await expect(loadJapaneseModel(abort.signal)).rejects.toThrow(/abort/iu);
    expect(download).not.toHaveBeenCalled();
  });
});
