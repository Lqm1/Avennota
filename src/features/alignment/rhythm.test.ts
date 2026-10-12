import { describe, expect, it } from "vitest";

import { regularizeRepeatedVowels } from "./rhythm";

describe("同一母音のBPM補正", () => {
  it("極端に短い分割を補い、元の境界と外側の区間を保つ", () => {
    const original = {
      cvOnset: null,
      wav: "_ああ.wav",
      duration: 2,
      morae: [
        { kana: "あ", phones: ["a"] },
        { kana: "あ", phones: ["a"] },
      ],
      intervals: [
        { name: "a", start: 0.51, end: 0.63 },
        { name: "a", start: 0.63, end: 1.46 },
      ],
    };
    const result = regularizeRepeatedVowels(original, 120);
    expect(result.recording.intervals).toStrictEqual([
      { name: "a", start: 0.51, end: 1.01 },
      { name: "a", start: 1.01, end: 1.46 },
    ]);
    expect(result.corrections).toStrictEqual([
      { wav: "_ああ.wav", phone: "a", before: 0.63, after: 1.01 },
    ]);
    expect(original.intervals[0]?.end).toBe(0.63);
  });

  it("区間が足りない録音には拍を押し込まない", () => {
    const original = {
      cvOnset: null,
      wav: "ああ.wav",
      duration: 1,
      morae: [],
      intervals: [
        { name: "a", start: 0, end: 0.05 },
        { name: "a", start: 0.05, end: 0.2 },
      ],
    };
    expect(regularizeRepeatedVowels(original, 120).corrections).toHaveLength(0);
    expect(() => regularizeRepeatedVowels(original, 0)).toThrow("BPM");
  });
});
