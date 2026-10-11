import { describe, expect, it } from "vitest";

import { decodeBytes } from "../oto/encoding";
import { parseOto, serializeOto } from "../oto/oto-set";
import { advancedSettingsSchema, DEFAULT_ADVANCED } from "./advanced-settings";
import { readComments, writeComments } from "./comments";
import {
  complementAliases,
  mergeRows,
  sortRows,
  parseUstNotes,
  annotateUst,
  ustTargets,
} from "./manual-tools";
import {
  frequencyNote,
  noteFrequency,
  pitchTargetPreset,
} from "./pitch-settings";
import {
  deserializeOtoSet,
  serializeOtoSetForRecovery,
  storedOtoSetSchema,
} from "./recovery-data";

const bytes = (text: string) => new TextEncoder().encode(text);
const aliases = (set: ReturnType<typeof parseOto>) =>
  set.lines.flatMap((line) =>
    line.parsed.kind === "oto" ? [line.parsed.oto.alias] : []
  );
describe("手動ツール", () => {
  it("ターゲット音から解析上下限と上下2半音の表示範囲を決める", () => {
    expect(noteFrequency(69)).toBe(440);
    expect(frequencyNote(440)).toBe(69);
    const preset = pitchTargetPreset({
      ...DEFAULT_ADVANCED,
      targetPitch: noteFrequency(60),
    });
    expect({
      min: preset.pitchMin,
      max: preset.pitchMax,
      fixed: preset.pitchFixedRange,
    }).toStrictEqual({ min: 118, max: 549, fixed: true });
    expect(preset.pitchDisplayMin).toBeCloseTo(noteFrequency(58));
    expect(preset.pitchDisplayMax).toBeCloseTo(noteFrequency(62));
  });

  it("仮名補完を重複させず、元行の値とコメントを維持する", () => {
    const source = readComments(
      parseOto(
        bytes(
          "お.wav=お,1,2,3,4,5\nじ.wav=じ,6,7,8,9,10\nず.wav=ず,0,0,0,0,0\n"
        )
      ),
      bytes("sample\n\n\n")
    );
    const result = complementAliases(source, "kana");
    expect(aliases(result)).toStrictEqual(["お", "を", "じ", "ぢ", "ず", "づ"]);
    expect(result.lines[0]?.comment).toBe("sample");
    expect(result.lines[1]?.text).toBe("お.wav=を,1,2,3,4,5");
    expect(complementAliases(result, "kana")).toBe(result);
  });

  it("連続音の不足を既存・外部エイリアスと照合し、追加行のIDを重複させない", () => {
    const source = parseOto(
      bytes(
        "か.wav=か,1,2,3,4,5\nか.wav=a か,1,2,3,4,5\n_き.wav=- き,0,0,0,0,0\n"
      )
    );
    const result = complementAliases(source, "continuous", new Set(["i か"]));
    expect(aliases(result)).toStrictEqual([
      "か",
      "a か",
      "u か",
      "e か",
      "o か",
      "n か",
      "- か",
      "- き",
    ]);
    expect(new Set(result.lines.map((line) => line.id)).size).toBe(
      result.lines.length
    );
  });

  it("仮名補完は複数の置換を組み合わせ、同名の後ろの行を複製元にする", () => {
    const source = parseOto(
      bytes("a.wav=おじ,1,2,3,4,5\nb.wav=おじ,6,7,8,9,10\n")
    );
    const result = complementAliases(source, "kana");
    expect(aliases(result)).toStrictEqual([
      "おじ",
      "おじ",
      "おぢ",
      "をじ",
      "をぢ",
    ]);
    expect(
      result.lines
        .slice(2)
        .every(
          (line) => line.parsed.kind === "oto" && line.parsed.oto.offset === 6
        )
    ).toBeTruthy();
    expect(complementAliases(result, "kana")).toBe(result);
  });

  it("並び替えはコメントを行と一緒に移し、マージは空行と元の内容を保持する", () => {
    const source = readComments(
      parseOto(bytes("b.wav=い,0,0,0,0,0\n\na.wav=あ,0,0,0,0,0\n")),
      bytes("B\nA\n")
    );
    const sorted = sortRows(source, "kana");
    expect(aliases(sorted)).toStrictEqual(["あ", "い"]);
    expect(sorted.lines[0]?.comment).toBe("A");
    expect(sorted.lines[1]?.parsed.kind).toBe("blank");
    const merged = mergeRows(source, bytes("c.wav=う,0,0,0,0,0\n"));
    expect(aliases(merged)).toStrictEqual(["い", "あ", "う"]);
    expect(serializeOto(merged).ok).toBeTruthy();
  });

  it("USTのノート番号と重複使用をコメントに記録し、休符と設定を除外する", () => {
    const notes = parseUstNotes(
      "[#SETTING]\nLyric=ignore\n[#0000]\nLyric=あ\n[#0001]\nLyric=R\n[#0002]\nLyric=あ\n[#TRACKEND]\n"
    );
    expect(notes).toStrictEqual([
      { alias: "あ", number: "0000" },
      { alias: "あ", number: "0002" },
    ]);
    expect(
      annotateUst(parseOto(bytes("a.wav=あ,0,0,0,0,0")), notes).lines[0]
        ?.comment
    ).toBe("UST: 0000, 0002");
  });

  it("コメントの入出力とJSON復元を経ても未編集iniのバイト列を変えない", () => {
    const original = bytes("a.wav=a,1.000,2,3,4,5\r\nb.wav=b,0,0,0,0,0\r\n");
    const source = readComments(
      parseOto(original),
      bytes("確認済み\r\nあとで確認\r\n")
    );
    expect(decodeBytes(writeComments(source), source.encoding)).toBe(
      "確認済み\r\nあとで確認\r\n"
    );
    const json = JSON.stringify(serializeOtoSetForRecovery(source));
    const parsed: unknown = JSON.parse(json);
    const recovered = deserializeOtoSet(storedOtoSetSchema.parse(parsed));
    expect(recovered.lines[0]?.comment).toBe("確認済み");
    const result = serializeOto(recovered);
    expect(result.ok).toBeTruthy();
    if (!result.ok) {
      throw new Error("保存失敗");
    }
    expect(result.bytes).toStrictEqual(original);
  });

  it("F0抽出・表示の逆転範囲を拒否する", () => {
    expect(
      advancedSettingsSchema.safeParse({
        ...DEFAULT_ADVANCED,
        pitchMin: 500,
        pitchMax: 100,
      }).success
    ).toBeFalsy();
    expect(
      advancedSettingsSchema.safeParse({
        ...DEFAULT_ADVANCED,
        pitchDisplayMin: 500,
        pitchDisplayMax: 100,
      }).success
    ).toBeFalsy();
  });

  it("仮名順は先行母音を後ろへ回し、音名をまとめて並べる", () => {
    const source = parseOto(
      bytes(
        "b.wav=a い,0,0,0,0,0\na.wav=i あ2,0,0,0,0,0\nc.wav=a あ1,0,0,0,0,0\n"
      )
    );
    expect(aliases(sortRows(source, "kana"))).toStrictEqual([
      "a あ1",
      "i あ2",
      "a い",
    ]);
  });

  it("USTの末尾付きエイリアスを対象にし、続く仮名を除外して重複上限を適用する", () => {
    const source = parseOto(
      bytes(
        "a.wav=あ_C4,0,0,0,0,0\nb.wav=あ_D4,0,0,0,0,0\nc.wav=あい,0,0,0,0,0\nあ.wav=other,0,0,0,0,0\n"
      )
    );
    const notes = [{ alias: "あ", number: "0001" }];
    expect(ustTargets(source, notes).size).toBe(3);
    expect(ustTargets(source, notes, 1).size).toBe(1);
    const commented = annotateUst(source, notes, "使用", 1);
    expect(commented.lines.map((line) => line.comment)).toStrictEqual([
      "使用",
      undefined,
      undefined,
      undefined,
    ]);
  });
});
