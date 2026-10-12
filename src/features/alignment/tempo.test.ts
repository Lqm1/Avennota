import { describe, expect, it } from "vitest";

import type { AlignedRecording } from "./client";
import { estimateRecordingTempo, selectTempoRecordings } from "./tempo";

const recording = (bpm: number, offset = 1): AlignedRecording => {
  const phones = ["a", "i", "u", "e", "o", "a", "i", "u"];
  return {
    wav: `${bpm}.wav`,
    cvOnset: null,
    duration: offset + (9 * 60) / bpm,
    morae: phones.map((phone) => ({ kana: phone, phones: [phone] })),
    intervals: phones.map((name, at) => ({
      name,
      start: offset + (at * 60) / bpm + (at % 2 ? 0.015 : -0.015),
      end: offset + ((at + 1) * 60) / bpm,
    })),
  };
};

describe("収録BPMの推定", () => {
  it.each([50, 80, 90, 100, 110, 120, 130, 140, 160, 200])(
    "境界誤差と録音開始位置が異なっても%d BPMを推定する",
    (bpm) => {
      expect(
        estimateRecordingTempo([recording(bpm), recording(bpm, 3)])
      ).toStrictEqual({ kind: "estimated", bpm, recordings: 2 });
    }
  );

  it("少数の外れ値に影響されず、録音ごとの合意を要求する", () => {
    expect(
      estimateRecordingTempo([
        recording(100),
        recording(100),
        recording(100),
        recording(140),
      ])
    ).toStrictEqual({ kind: "estimated", bpm: 100, recordings: 3 });
    expect(
      estimateRecordingTempo([recording(80), recording(140)])
    ).toStrictEqual({ kind: "unavailable" });
  });

  it("範囲を制限せず最寄りの10 BPMへ丸める", () => {
    expect(estimateRecordingTempo([recording(122)])).toStrictEqual({
      kind: "estimated",
      bpm: 120,
      recordings: 1,
    });
    expect(estimateRecordingTempo([recording(162)])).toStrictEqual({
      kind: "estimated",
      bpm: 160,
      recordings: 1,
    });
  });

  it("単独音では推定値を作らない", () => {
    const short = recording(120);
    short.morae = short.morae.slice(0, 1);
    short.intervals = short.intervals.slice(0, 1);
    expect(selectTempoRecordings([short])).toHaveLength(0);
    expect(estimateRecordingTempo([short])).toStrictEqual({
      kind: "unavailable",
    });
  });
});
