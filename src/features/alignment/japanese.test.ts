import { describe, expect, it } from "vitest";

import { parseMorae, transcriptionFromFilename } from "./japanese";

describe("日本語の発音列", () => {
  it("半角カタカナ・拗音・促音・撥音・長音をモデルの音素へ変換する", () => {
    expect(
      parseMorae("_ｷｬｯﾄﾝｼｪｰ_").flatMap((mora) => mora.phones)
    ).toStrictEqual(["ky", "a", "cl", "t", "o", "N", "sh", "e", "e"]);
  });

  it("途中の区切りは無音とし前後の区切りを外す", () => {
    expect(parseMorae("_あ_い_").flatMap((mora) => mora.phones)).toStrictEqual([
      "a",
      "pau",
      "i",
    ]);
  });

  it("未知の文字や音階を勝手に捨てない", () => {
    expect(() => parseMorae("あA4")).toThrow("A4");
    expect(() => parseMorae("ー")).toThrow("長音");
    expect(() => parseMorae("_")).toThrow("空");
    expect(transcriptionFromFilename("_あい_A4.WAV", "_A4")).toBe("_あい");
    expect(transcriptionFromFilename("_あい_A4.WAV", "")).toBe("_あい_A4");
  });

  it("CVVC収録のてゃ・でょを拗音として読む", () => {
    expect(parseMorae("てゃでょ").flatMap((mora) => mora.phones)).toStrictEqual(
      ["ty", "a", "dy", "o"]
    );
  });
});
