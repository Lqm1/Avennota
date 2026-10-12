import { describe, expect, it } from "vitest";

import { createLabelExports } from "./label-export";
import type { LabelRecording } from "./label-export";

const recording: LabelRecording = {
  wav: "か.wav",
  duration: 1,
  intervals: [
    { name: "k", start: 0.1, end: 0.25 },
    { name: "a", start: 0.25, end: 0.8 },
  ],
};

describe("音素ラベルの書き出し", () => {
  it("日本語のWAV名でHTKラベルを生成し、原音全体を100ns単位で覆う", () => {
    const document = createLabelExports([recording]);
    expect(document.map(({ name }) => name)).toStrictEqual(["か.lab"]);
    const bytes = document[0]?.bytes;
    expect(bytes).toBeDefined();
    expect(new TextDecoder().decode(bytes)).toBe(
      "0 1000000 pau\n1000000 2500000 k\n2500000 8000000 a\n8000000 10000000 pau\n"
    );
    expect(recording.intervals).toHaveLength(2);
  });

  it("内部の無音・同じ音素の連続を保ち、音素長の合計が原音長と一致する", () => {
    const document = createLabelExports([
      {
        wav: "ああ.wav",
        duration: 1.2345678,
        intervals: [
          { name: "a", start: 0, end: 0.12 },
          { name: "pau", start: 0.12, end: 0.2 },
          { name: "a", start: 0.2, end: 0.21 },
          { name: "a", start: 0.21, end: 1.2345678 },
        ],
      },
    ]);
    const bytes = document[0]?.bytes;
    expect(new TextDecoder().decode(bytes)).toBe(
      "0 1200000 a\n1200000 2000000 pau\n2000000 2100000 a\n2100000 12345678 a\n"
    );
  });

  it("ゼロ長の端の音素を除外し、WAVごとのラベルを生成する", () => {
    const document = createLabelExports([
      recording,
      {
        wav: "い.WAV",
        duration: 0.5,
        intervals: [
          { name: "pau", start: 0, end: 0 },
          { name: "i", start: 0, end: 0.5 },
        ],
      },
    ]);
    expect(document.map(({ name }) => name)).toStrictEqual([
      "か.lab",
      "い.lab",
    ]);
    const bytes = document[1]?.bytes;
    expect(new TextDecoder().decode(bytes)).toBe("0 5000000 i\n");
  });
});
