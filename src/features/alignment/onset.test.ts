import { describe, expect, it } from "vitest";

import { inferCvOnset } from "./onset";
import type { AlignmentResult } from "./types";

const RATE = 16_000;
const recording: AlignmentResult = {
  duration: 1,
  intervals: [
    { name: "ky", start: 0.15, end: 0.24 },
    { name: "a", start: 0.24, end: 0.9 },
  ],
};
const samples = () => {
  let random = 71;
  return Float32Array.from({ length: RATE }, (_, at) => {
    const time = at / RATE;
    if (time < 0.07 || time >= 0.9) {
      return 0;
    }
    if (time < 0.1) {
      random = (random * 16_807) % 2_147_483_647;
      return (random / 2_147_483_647 - 0.5) * 0.3;
    }
    return Math.sin(2 * Math.PI * 250 * time) * 0.7;
  });
};

describe("単独音の有声開始", () => {
  it("子音が無音側に含まれた推定から、子音と有声開始を回復する", () => {
    const before = structuredClone(recording);
    const result = inferCvOnset(recording, samples(), RATE);
    expect(result?.voicingStart).toBeGreaterThanOrEqual(0.095);
    expect(result?.voicingStart).toBeLessThanOrEqual(0.12);
    expect(result?.speechStart).toBeLessThanOrEqual(0.07);
    expect(result?.speechStart).toBeGreaterThanOrEqual(0.065);
    expect(recording).toStrictEqual(before);
  });

  it("無音、非周期的な音、既に正しい境界には補正を作らない", () => {
    expect(inferCvOnset(recording, new Float32Array(RATE), RATE)).toBeNull();
    let random = 17;
    const noise = Float32Array.from({ length: RATE }, () => {
      random = (random * 16_807) % 2_147_483_647;
      return random / 2_147_483_647 - 0.5;
    });
    expect(inferCvOnset(recording, noise, RATE)).toBeNull();
    expect(
      inferCvOnset(
        {
          ...recording,
          intervals: [
            { name: "k", start: 0.07, end: 0.1 },
            { name: "a", start: 0.1, end: 0.9 },
          ],
        },
        samples(),
        RATE
      )
    ).toBeNull();
  });

  it("有声子音、無声化母音、複数モーラの境界には適用しない", () => {
    for (const name of ["m", "n", "g", "y", "w"]) {
      expect(
        inferCvOnset(
          {
            ...recording,
            intervals: [
              { name, start: 0.15, end: 0.24 },
              { name: "a", start: 0.24, end: 0.9 },
            ],
          },
          samples(),
          RATE
        )
      ).toBeNull();
    }
    expect(
      inferCvOnset(
        {
          ...recording,
          intervals: [
            { name: "k", start: 0.15, end: 0.24 },
            { name: "I", start: 0.24, end: 0.9 },
          ],
        },
        samples(),
        RATE
      )
    ).toBeNull();
    expect(
      inferCvOnset(
        {
          ...recording,
          intervals: [
            ...recording.intervals,
            { name: "i", start: 0.9, end: 1 },
          ],
        },
        samples(),
        RATE
      )
    ).toBeNull();
  });
});
