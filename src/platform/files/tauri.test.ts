import { describe, expect, it } from "vitest";

import { nativeRecoveryId } from "./tauri";

describe("ネイティブ版の復元ID", () => {
  it("大文字・小文字が異なる音源フォルダの復元データを混同しない", async () => {
    const upper = await nativeRecoveryId("/home/user/Voice");
    const lower = await nativeRecoveryId("/home/user/voice");
    expect(upper).not.toBe(lower);
    await expect(nativeRecoveryId("/home/user/Voice")).resolves.toBe(upper);
  });
});
