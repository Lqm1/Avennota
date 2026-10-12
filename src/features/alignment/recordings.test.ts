import { describe, expect, it } from "vitest";

import {
  filenameTranscript,
  readRecordingIndex,
  recordingTranscript,
} from "./recordings";

describe("録音の発音列", () => {
  it("くぁ・くぃ・くぇ・くぉと濁音をそれぞれ1モーラとして扱う", () => {
    const recording = recordingTranscript(
      "take.wav",
      "くぁくぃくぇくぉぐぁぐぃぐぇぐぉ"
    );
    expect(recording.morae).toStrictEqual([
      { kana: "くぁ", phones: ["k", "w", "a"] },
      { kana: "くぃ", phones: ["k", "w", "i"] },
      { kana: "くぇ", phones: ["k", "w", "e"] },
      { kana: "くぉ", phones: ["k", "w", "o"] },
      { kana: "ぐぁ", phones: ["g", "w", "a"] },
      { kana: "ぐぃ", phones: ["g", "w", "i"] },
      { kana: "ぐぇ", phones: ["g", "w", "e"] },
      { kana: "ぐぉ", phones: ["g", "w", "o"] },
    ]);
  });

  it("C_G4の外来音を含む録音を8モーラとして読み取る", () => {
    for (const wav of [
      "_くぇんくぇくぇくぉくぇくぁくぇ.wav",
      "_ぐぁんぐぁぐぁぐぃぐぁぐぐぁ.wav",
      "_すぃんすぃすぃすすぃせすぃ.wav",
      "_ずぃんずぃずぃずずぃぜずぃ.wav",
    ]) {
      expect(filenameTranscript(wav, "").morae).toHaveLength(8);
    }
    expect(recordingTranscript("take.wav", "すぃずぃ").morae).toStrictEqual([
      { kana: "すぃ", phones: ["s", "i"] },
      { kana: "ずぃ", phones: ["z", "i"] },
    ]);
  });

  it("index.csvの行順を保ち、読めないWAV名でも音素列から標準仮名を作る", () => {
    const index = readRecordingIndex("take02,k a sh I\ntake01,a i\n");
    expect([...index.keys()]).toStrictEqual(["take02.wav", "take01.wav"]);
    expect(
      recordingTranscript("take02.wav", undefined, index.get("take02.wav"))
    ).toStrictEqual({
      wav: "take02.wav",
      morae: [
        { kana: "か", phones: ["k", "a"] },
        { kana: "し", phones: ["sh", "I"] },
      ],
    });
  });

  it("手動の仮名は保持し、無声化母音と一致させる", () => {
    expect(
      recordingTranscript("take.wav", "をか", ["o", "k", "A"]).morae
    ).toStrictEqual([
      { kana: "を", phones: ["o"] },
      { kana: "か", phones: ["k", "A"] },
    ]);
    expect(() => recordingTranscript("take.wav", "か", ["g", "a"])).toThrow(
      "一致"
    );
  });

  it("重複・空の音素列・フォルダを含むWAV名を拒否する", () => {
    expect(() => readRecordingIndex("take,a\ntake.wav,i")).toThrow("重複");
    expect(() => readRecordingIndex("take,")).toThrow("不正");
    expect(() => readRecordingIndex("../take,a")).toThrow("不正");
  });
});
