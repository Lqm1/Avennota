import { describe, expect, it } from "vitest";

import { createEmptyOtoSet, parseOto, serializeOto } from "../oto/oto-set";
import type { AlignedRecording } from "./client";
import { parseMorae } from "./japanese";
import {
  applyOtoSuggestions,
  continuousTiming,
  generateOtoSuggestions,
  readCvTimingTable,
} from "./oto-generation";

const recording: AlignedRecording = {
  cvOnset: null,
  wav: "_あかい.wav",
  duration: 3,
  morae: [
    { kana: "あ", phones: ["a"] },
    { kana: "か", phones: ["k", "a"] },
    { kana: "い", phones: ["i"] },
  ],
  intervals: [
    { name: "a", start: 0.5, end: 1 },
    { name: "k", start: 1, end: 1.1 },
    { name: "a", start: 1.1, end: 1.8 },
    { name: "i", start: 1.8, end: 2.5 },
  ],
};
const generate = (format: "cv" | "vcv" | "cvvc") =>
  generateOtoSuggestions(recording, {
    format,
    bpm: 120,
    suffix: "_A4",
    cvTimings: new Map(),
  });

describe("推定境界から原音設定への変換", () => {
  it("ヴのエイリアスをShift_JISで保存し、既存のひらがな表記も保持する", () => {
    const single: AlignedRecording = {
      cvOnset: null,
      wav: "_ヴぁ.wav",
      duration: 1,
      morae: parseMorae("ヴぁ"),
      intervals: [
        { name: "v", start: 0.05, end: 0.08 },
        { name: "a", start: 0.08, end: 0.9 },
      ],
    };
    const suggestions = generateOtoSuggestions(single, {
      format: "cv",
      bpm: 120,
      suffix: "",
      cvTimings: new Map([["ヴぁ", { preutter: 40, overlap: 10 }]]),
    });
    expect(suggestions[0]).toMatchObject({
      alias: "ヴぁ",
      preutter: 40,
      overlap: 10,
    });
    const serialized = serializeOto(
      applyOtoSuggestions(createEmptyOtoSet(), suggestions, "generate", 1)
    );
    if (!serialized.ok) {
      throw new Error("Shift_JISで保存できません。");
    }
    expect(parseOto(serialized.bytes).lines[0]).toMatchObject({
      parsed: { kind: "oto", oto: { alias: "ヴぁ" } },
    });
    const existing = parseOto(
      new TextEncoder().encode("_ヴぁ.wav=ゔぁ,0,0,-900,0,0\n"),
      "utf-8"
    );
    expect(
      applyOtoSuggestions(existing, suggestions, "update", 1).lines[0]
    ).toMatchObject({
      parsed: { kind: "oto", oto: { alias: "ゔぁ", preutter: 40 } },
    });
  });

  it("CVの有声開始を設定に使い、元の音素境界とVCVを保つ", () => {
    const single: AlignedRecording = {
      wav: "きゃ.wav",
      duration: 1,
      morae: [{ kana: "きゃ", phones: ["ky", "a"] }],
      intervals: [
        { name: "ky", start: 0.15, end: 0.24 },
        { name: "a", start: 0.24, end: 0.9 },
      ],
      cvOnset: { speechStart: 0.03, voicingStart: 0.065 },
    };
    const options = { bpm: 120, suffix: "", cvTimings: new Map() };
    expect(
      generateOtoSuggestions(single, { ...options, format: "cv" })[0]
    ).toMatchObject({ offset: 30, preutter: 35, consonant: 135 });
    expect(
      generateOtoSuggestions(single, {
        ...options,
        format: "cv",
        cvTimings: new Map([["きゃ", { preutter: 50, overlap: 10 }]]),
      })[0]
    ).toMatchObject({ offset: 15, preutter: 50, overlap: 10 });
    expect(
      generateOtoSuggestions(single, { ...options, format: "vcv" })[0]
    ).toMatchObject({ offset: 150, preutter: 90 });
    expect(single.intervals[1]?.start).toBe(0.24);
  });

  it("setParamのBPM初期値と3桁打ち切りに合わせる", () => {
    expect(continuousTiming(120)).toStrictEqual({
      offset: 0,
      preutter: 250,
      overlap: 83.333,
      consonant: 375,
      cutoff: -583.333,
    });
    expect(continuousTiming(140).overlap).toBe(71.428);
    expect(() => continuousTiming(0)).toThrow("BPM");
  });

  it("VCVの先行発声を推定母音の開始に置きBPMでオーバーラップを揃える", () => {
    const rows = generate("vcv");
    expect(rows.map((row) => row.alias)).toStrictEqual([
      "- あ_A4",
      "a か_A4",
      "a い_A4",
      "i R_A4",
    ]);
    const [, ka] = rows;
    expect(ka).toMatchObject({
      offset: 850,
      preutter: 250,
      overlap: 83.333,
      consonant: 375,
    });
    expect((ka?.offset ?? 0) + (ka?.preutter ?? 0)).toBe(1100);
  });

  it("CVVCではCV・VC・VVを別々の区間から生成する", () => {
    const rows = generate("cvvc");
    expect(rows.map((row) => row.alias)).toStrictEqual([
      "あ_A4",
      "か_A4",
      "a k_A4",
      "い_A4",
      "a い_A4",
      "i R_A4",
    ]);
    expect(rows.find((row) => row.alias === "a い_A4")).toMatchObject({
      preutter: 250,
      overlap: 83.333,
      consonant: 375,
    });
    expect(
      rows.every(
        (row) =>
          row.offset >= 0 &&
          row.consonant >= row.preutter &&
          -row.cutoff > row.consonant &&
          row.overlap <= row.preutter
      )
    ).toBeTruthy();
  });

  it("table.csvは指定された先行発声とオーバーラップを母音境界に合わせる", () => {
    const cvTimings = readCvTimingTable("か,k,a,50,70,0\r\n");
    const rows = generateOtoSuggestions(recording, {
      format: "cv",
      bpm: 120,
      suffix: "",
      cvTimings,
    });
    expect(rows[1]).toMatchObject({ offset: 1030, preutter: 70, overlap: 0 });
    expect(() => readCvTimingTable("か,k,a,50,no,0")).toThrow("1行目");
  });

  it("語尾を無音内で止め、単独音には追加しない", () => {
    const separated: AlignedRecording = {
      cvOnset: null,
      wav: "あ_い.wav",
      duration: 2,
      morae: [
        { kana: "あ", phones: ["a"] },
        { kana: "_", phones: ["pau"] },
        { kana: "い", phones: ["i"] },
      ],
      intervals: [
        { name: "a", start: 0.2, end: 0.6 },
        { name: "pau", start: 0.6, end: 0.9 },
        { name: "i", start: 0.9, end: 1.8 },
      ],
    };
    const options = { bpm: 120, suffix: "", cvTimings: new Map() };
    const rows = generateOtoSuggestions(separated, {
      ...options,
      format: "vcv",
    });
    expect(rows.map((row) => row.alias)).toStrictEqual([
      "- あ",
      "a R",
      "- い",
      "i R",
    ]);
    const release = rows.find((row) => row.alias === "a R");
    expect((release?.offset ?? 0) - (release?.cutoff ?? 0)).toBeLessThanOrEqual(
      900
    );
    expect(
      generateOtoSuggestions(separated, { ...options, format: "cv" }).map(
        (row) => row.alias
      )
    ).toStrictEqual(["あ", "い"]);
  });

  it("CVVCの撥音はCVと鼻音への遷移を作る", () => {
    const nasal: AlignedRecording = {
      cvOnset: null,
      wav: "あん.wav",
      duration: 2,
      morae: [
        { kana: "あ", phones: ["a"] },
        { kana: "ん", phones: ["N"] },
      ],
      intervals: [
        { name: "a", start: 0.2, end: 0.7 },
        { name: "N", start: 0.7, end: 1.2 },
      ],
    };
    const rows = generateOtoSuggestions(nasal, {
      format: "cvvc",
      bpm: 120,
      suffix: "",
      cvTimings: new Map(),
    });
    expect(rows.map((row) => row.alias)).toStrictEqual([
      "あ",
      "ん",
      "a n",
      "n R",
    ]);
  });

  it("補正では名前・コメント・順序・未編集行と右ブランクの表現を保つ", () => {
    const set = parseOto(
      new TextEncoder().encode(
        "_あかい.wav=a か_A4,0,0,100,0,0\r\nunknown text\r\nother.wav=他,0,0,-200,0,0\r\n"
      )
    );
    const [first] = set.lines;
    if (first) {
      first.comment = "確認済み";
    }
    const next = applyOtoSuggestions(set, generate("vcv"), "update", 1, "_A4");
    expect(next.lines.slice(1)).toStrictEqual(set.lines.slice(1));
    expect(next.lines[0]).toMatchObject({
      id: first?.id,
      comment: "確認済み",
      parsed: { kind: "oto", oto: { alias: "a か_A4", cutoff: 1566.667 } },
    });
    expect(serializeOto(next).ok).toBeTruthy();
    expect(applyOtoSuggestions(next, generate("vcv"), "update", 1, "_A4")).toBe(
      next
    );
  });

  it("重複上限と番号を接尾辞より前に適用し未解釈行を残す", () => {
    const set = parseOto(new TextEncoder().encode("unknown text\n"));
    const rows = generate("vcv");
    const suggestions = [...rows, ...rows];
    const limited = applyOtoSuggestions(set, suggestions, "generate", 1, "_A4");
    const unlimited = applyOtoSuggestions(
      set,
      suggestions,
      "generate",
      0,
      "_A4"
    );
    expect(limited.lines).toHaveLength(5);
    expect(unlimited.lines).toHaveLength(9);
    expect(unlimited.lines[5]?.text).toContain("- あ2_A4");
    expect(unlimited.lines[0]).toBe(set.lines[0]);
  });

  it("補正では別の録音についた重複番号を保つ", () => {
    const set = parseOto(
      new TextEncoder().encode("_あかい.wav=a か2_A4,0,0,-200,0,0\n")
    );
    const next = applyOtoSuggestions(set, generate("vcv"), "update", 1, "_A4");
    expect(next.lines[0]).toMatchObject({
      parsed: {
        kind: "oto",
        oto: { alias: "a か2_A4", offset: 850, preutter: 250 },
      },
    });
  });

  it("moresamplerの語尾名と1から始まる重複番号を保持して補正する", () => {
    const set = parseOto(
      new TextEncoder().encode(
        "_あかい.wav=a か1_A4,0,0,-200,0,0\n_あかい.wav=i -1_A4,0,0,-200,0,0\n"
      )
    );
    const next = applyOtoSuggestions(set, generate("vcv"), "update", 1, "_A4");
    expect(next.lines[0]).toMatchObject({
      parsed: { kind: "oto", oto: { alias: "a か1_A4", offset: 850 } },
    });
    expect(next.lines[1]).toMatchObject({
      parsed: {
        kind: "oto",
        oto: { alias: "i -1_A4", offset: 2250, preutter: 250 },
      },
    });
  });
});
