import { describe, expect, it } from "vitest";

import { cutoffEnd, toggleCutoffSign } from "./geometry";

const params = {
  consonant: 100,
  cutoff: -300,
  offset: 200,
  overlap: 30,
  preutter: 80,
};

describe("右ブランク", () => {
  it("正負の表現を終端の絶対位置へ変換する", () => {
    expect(cutoffEnd(params, 1000)).toBe(500);
    expect(cutoffEnd({ ...params, cutoff: 100 }, 1000)).toBe(900);
  });

  it("符号を往復しても終端の位置を保持する", () => {
    const positive = { ...params, ...toggleCutoffSign(params, 1000) };
    expect(positive.cutoff).toBe(500);
    expect(cutoffEnd(positive, 1000)).toBe(500);
    const negative = { ...positive, ...toggleCutoffSign(positive, 1000) };
    expect(negative).toStrictEqual(params);
  });
});
