import { describe, expect, it } from "vitest";

import { readRecordingIndex, recordingTranscript } from "./recordings";

describe("録音の発音列", () => {
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
