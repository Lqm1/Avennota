import { describe, expect, it } from "vitest";

import { SyllableTable } from "../alignment/syllable-table";
import { decodeBytes, encodeText } from "../oto/encoding";
import type { OtoSet } from "../oto/oto-set";
import { isOtoLine, parseOto, serializeOto } from "../oto/oto-set";
import { AliasRules } from "./alias-rules";
import type { BatchResult } from "./batch";
import { deleteLines } from "./batch";
import { findDuplicateGroups, removeDuplicates } from "./duplicate-aliases";
import { transformParameters } from "./parameter-transforms";
import type { ParameterOperation } from "./parameter-transforms";
import { extractLines, RowQuery } from "./row-query";
import type { RowQueryOptions } from "./row-query";
import { convertVoicebank } from "./voicebank-conversion";
import type { ConversionOptions } from "./voicebank-conversion";

const load = (text: string) => parseOto(new TextEncoder().encode(text));
const all = (set: OtoSet) => new Set(set.lines.map((line) => line.id));
const texts = (set: OtoSet) =>
  set.lines
    .filter((line) => line.parsed.kind !== "blank")
    .map((line) => line.text);
const aliasesOf = (set: OtoSet, ids: readonly string[]) =>
  ids.map((id) => {
    const line = set.lines.find((candidate) => candidate.id === id);
    return line !== undefined && isOtoLine(line)
      ? line.parsed.oto.alias
      : line?.text;
  });
const kinds = (result: BatchResult) =>
  result.entries.map((entry) => entry.kind);

const query = (patch: Partial<RowQueryOptions>): RowQueryOptions => ({
  field: "alias",
  mode: "contains",
  text: "",
  ignoreCase: false,
  excludeYoon: false,
  ...patch,
});

describe("検索・置換・抽出", () => {
  const set = load(
    "a.wav=a き,1,2,3,4,5\na.wav=a きゃ,1,2,3,4,5\nき.wav=,1,2,3,4,5\nbroken\nb.wav=A_C4,1,2,3,4,5\n"
  );

  it("部分一致は直後の小書きかなを除けて探す", () => {
    expect(
      aliasesOf(
        set,
        new RowQuery(query({ text: "き" })).matchingIds(set, all(set))
      )
    ).toStrictEqual(["a き", "a きゃ", ""]);
    expect(
      aliasesOf(
        set,
        new RowQuery(query({ text: "き", excludeYoon: true })).matchingIds(
          set,
          all(set)
        )
      )
    ).toStrictEqual(["a き", ""]);
    expect(
      new RowQuery(query({ text: "き", mode: "exact" })).matchingIds(
        set,
        all(set)
      )
    ).toHaveLength(1);
  });

  it("大小文字の扱いと正規表現の構文エラーを区別する", () => {
    expect(
      new RowQuery(query({ text: "a_c4" })).matchingIds(set, all(set))
    ).toHaveLength(0);
    expect(
      new RowQuery(query({ text: "a_c4", ignoreCase: true })).matchingIds(
        set,
        all(set)
      )
    ).toHaveLength(1);
    expect(
      new RowQuery(
        query({ text: String.raw`^a .{2}$`, mode: "regex" })
      ).matchingIds(set, all(set))
    ).toHaveLength(1);
    expect(() => new RowQuery(query({ text: "(", mode: "regex" }))).toThrow(
      "Invalid regular expression"
    );
    expect(() => new RowQuery(query({ text: "" }))).toThrow("検索する文字列");
  });

  it("原文の検索は解釈できない行も対象にし、対象外の行は探さない", () => {
    expect(
      aliasesOf(
        set,
        new RowQuery(query({ field: "text", text: "brok" })).matchingIds(
          set,
          all(set)
        )
      )
    ).toStrictEqual(["broken"]);
    const [first] = set.lines;
    expect(
      new RowQuery(query({ text: "き" })).matchingIds(
        set,
        new Set([first?.id ?? ""])
      )
    ).toHaveLength(1);
  });

  it("文字列は全箇所をそのまま、正規表現は$1を使って置換する", () => {
    const literal = new RowQuery(query({ text: "き" })).replace(
      set,
      all(set),
      "$&ぎ",
      false
    );
    expect(texts(literal.otoSet).slice(0, 3)).toStrictEqual([
      "a.wav=a $&ぎ,1,2,3,4,5",
      "a.wav=a $&ぎゃ,1,2,3,4,5",
      "き.wav=$&ぎ,1,2,3,4,5",
    ]);
    const regex = new RowQuery(
      query({ text: String.raw`^(\w) (.)`, mode: "regex" })
    ).replace(set, all(set), "$2 $1", false);
    expect(texts(regex.otoSet)[0]).toBe("a.wav=き a,1,2,3,4,5");
    const comma = new RowQuery(query({ text: "A" })).replace(
      set,
      all(set),
      "x,y",
      false
    );
    expect(kinds(comma)).toStrictEqual(["error"]);
    expect(comma.otoSet).toBe(set);
  });

  it("抽出したiniは元の文字コード・改行・行のバイト列を保つ", () => {
    const bytes = encodeText(
      "あ.wav=あ,1.0,2,3,4,5\r\nい.wav=い,1,2,3,4,5\r\nう.wav=う,1,2,3,4,5",
      "shift_jis"
    );
    const source = parseOto(Uint8Array.from(bytes));
    const [first, , third] = source.lines;
    const extracted = serializeOto(
      extractLines(source, new Set([first?.id ?? "", third?.id ?? ""]))
    );
    if (!extracted.ok) {
      throw new Error("保存できません");
    }
    expect(decodeBytes(extracted.bytes, "shift_jis")).toBe(
      "あ.wav=あ,1.0,2,3,4,5\r\nう.wav=う,1,2,3,4,5"
    );
  });

  it("一括削除はWAVの最初の行を既定で残す", () => {
    const source = load(
      "a.wav=x,0,0,0,0,0\na.wav=y,0,0,0,0,0\nb.wav=z,0,0,0,0,0\n"
    );
    const kept = deleteLines(source, all(source), false);
    expect(kinds(kept)).toStrictEqual(["skip", "delete", "skip"]);
    expect(texts(kept.otoSet)).toStrictEqual([
      "a.wav=x,0,0,0,0,0",
      "b.wav=z,0,0,0,0,0",
    ]);
    const removed = deleteLines(source, all(source), true);
    expect(texts(removed.otoSet)).toStrictEqual([]);
    expect(removed.entries[2]?.note).toBe("このWAVの原音設定がなくなります");
  });
});

describe("規則によるエイリアスの複製・置換", () => {
  it("2列の規則を読み、形式の違う行を行番号付きで知らせる", () => {
    expect(AliasRules.parse("a お,a を\r\n\r\nき,ぎ").rules).toStrictEqual([
      { source: "a お", target: "a を" },
      { source: "き", target: "ぎ" },
    ]);
    expect(() => AliasRules.parse("a お,a を\nx")).toThrow("2行目");
    expect(() => AliasRules.parse("a,b,c")).toThrow("1行目");
  });

  it("装飾を残して末尾へ複製し、既存の名前とは重ねない", () => {
    const source = load(
      "a.wav=a お_強_C4,1,2.0,3,4,5,extra\n" +
        "b.wav=a お,1,2,3,4,5\n" +
        "c.wav=a を_強_C4,0,0,0,0,0\n" +
        "d.wav=a おぃ,0,0,0,0,0\n"
    );
    const [first] = source.lines;
    if (first) {
      first.comment = "メモ";
    }
    const rules = AliasRules.parse("a お,a を");
    const exact = rules.duplicate(source, all(source), {
      mode: "exact",
      allowDuplicates: false,
    });
    expect(texts(exact.otoSet).at(-1)).toBe("b.wav=a を,1,2,3,4,5");
    const suffix = rules.duplicate(source, all(source), {
      mode: "keepSuffix",
      allowDuplicates: false,
    });
    expect(kinds(suffix)).toStrictEqual(["skip", "add"]);
    const allowed = rules.duplicate(source, all(source), {
      mode: "keepSuffix",
      allowDuplicates: true,
    });
    expect(texts(allowed.otoSet).slice(4)).toStrictEqual([
      "a.wav=a を_強_C4,1,2.0,3,4,5,extra",
      "b.wav=a を,1,2,3,4,5",
    ]);
    expect(allowed.otoSet.lines[4]?.comment).toBe("メモ");
  });

  it("複数規則は規則順・行順で追加し、生成した行を次の規則に使わない", () => {
    const source = load("a.wav=か,0,0,0,0,0\nb.wav=き,0,0,0,0,0\n");
    const result = AliasRules.parse("き,ぎ\nか,が\nが,ご").duplicate(
      source,
      all(source),
      { mode: "exact", allowDuplicates: false }
    );
    expect(texts(result.otoSet).slice(2)).toStrictEqual([
      "b.wav=ぎ,0,0,0,0,0",
      "a.wav=が,0,0,0,0,0",
    ]);
  });

  it("置換は規則を順に重ね、空になる名前や重複を作らない", () => {
    const source = load("a.wav=a か_C4,0,0,0,0,0\nb.wav=カ,0,0,0,0,0\n");
    const chained = AliasRules.parse("か,が\nが,ぐ\n_C4,").rename(
      source,
      all(source),
      { mode: "keepBoth", allowDuplicates: false, all: false }
    );
    expect(texts(chained.otoSet)[0]).toBe("a.wav=a ぐ,0,0,0,0,0");
    const empty = AliasRules.parse("カ,").rename(source, all(source), {
      mode: "exact",
      allowDuplicates: false,
      all: false,
    });
    expect(kinds(empty)).toStrictEqual(["error"]);
    const duplicate = AliasRules.parse("カ,a か_C4").rename(
      source,
      all(source),
      {
        mode: "exact",
        allowDuplicates: false,
        all: false,
      }
    );
    expect(kinds(duplicate)).toStrictEqual(["skip"]);
  });
});

describe("重複エイリアスの整理", () => {
  const source = load(
    "1.wav=a か_C4,1,0,0,0,0\n" +
      "2.wav=a か_C4,2,0,0,0,0\n" +
      "2.wav=a か_D4,0,0,0,0,0\n" +
      "2.wav=a か2_C4,0,0,0,0,0\n" +
      "foo.wav=,0,0,0,0,0\n" +
      "3.wav=foo,0,0,0,0,0\n"
  );

  it("UTAUで呼ばれる名前の完全一致でまとめ、音階や番号の違いは別にする", () => {
    const groups = findDuplicateGroups(source);
    expect(groups.map((group) => group.key)).toStrictEqual(["a か_C4", "foo"]);
    expect(
      findDuplicateGroups(source, /\d(?=_)/gu).map(
        (group) => group.lineIds.length
      )
    ).toStrictEqual([3, 2]);
  });

  it("残す行以外を削除し、WAVの最後の行は許可したときだけ消す", () => {
    const groups = findDuplicateGroups(source);
    const keep = new Set(groups.map((group) => group.lineIds[0] ?? ""));
    const guarded = removeDuplicates(source, groups, keep, false);
    expect(kinds(guarded)).toStrictEqual(["delete", "skip"]);
    const removed = removeDuplicates(source, groups, keep, true);
    expect(texts(removed.otoSet)).toStrictEqual([
      "1.wav=a か_C4,1,0,0,0,0",
      "2.wav=a か_D4,0,0,0,0,0",
      "2.wav=a か2_C4,0,0,0,0,0",
      "foo.wav=,0,0,0,0,0",
    ]);
    const none = removeDuplicates(source, groups, new Set(), true);
    expect(none.otoSet).toBe(source);
  });
});

describe("先行発声・オーバーラップの調整", () => {
  const source = load("a.wav=a か,1000,375,-600,250,100\n");
  const run = (operation: ParameterOperation, set = source, digits = 3) =>
    transformParameters(set, all(set), operation, {
      digits,
      continuousOnly: false,
    });

  it("指定の先行発声にして先行発声・固定範囲・終端の位置を保つ", () => {
    expect(texts(run({ kind: "preutter", value: 200 }).otoSet)).toStrictEqual([
      "a.wav=a か,1050,325,-550,200,66.667",
    ]);
    expect(texts(run({ kind: "overlapThird" }).otoSet)).toStrictEqual([
      "a.wav=a か,1000,375,-600,250,83.333",
    ]);
  });

  it("先行発声とオーバーラップの位置を保って3:1にする", () => {
    expect(texts(run({ kind: "ratio" }).otoSet)).toStrictEqual([
      "a.wav=a か,1025,350,-575,225,75",
    ]);
    const reversed = load("a.wav=a か,1000,375,-600,100,100\n");
    expect(kinds(run({ kind: "ratio" }, reversed))).toStrictEqual(["error"]);
  });

  it("正の右ブランクは末尾からの距離なので変えない", () => {
    const positive = load("a.wav=a か,1000,375,120,250,100\n");
    expect(
      texts(run({ kind: "preutter", value: 200 }, positive).otoSet)
    ).toStrictEqual(["a.wav=a か,1050,325,120,200,66.667"]);
  });

  it("BPMから8分音符の先行発声を作り、先行発声の位置を保つ", () => {
    expect(texts(run({ kind: "bpm", bpm: 120 }).otoSet)).toStrictEqual([
      "a.wav=a か,1000,375,-583.333,250,83.333",
    ]);
    expect(texts(run({ kind: "bpm", bpm: 140 }).otoSet)).toStrictEqual([
      "a.wav=a か,1035.714,321.429,-500,214.286,71.429",
    ]);
    const rounded = run({ kind: "bpm", bpm: 140 }, source, 0).otoSet;
    const [line] = rounded.lines;
    if (line === undefined || !isOtoLine(line)) {
      throw new Error("行がありません");
    }
    expect(line.parsed.oto.offset + line.parsed.oto.preutter).toBe(1250);
    expect(line.text).toBe("a.wav=a か,1036,321,-500,214,71");
  });

  it("成り立たない行は適用せず、連続音だけを選べる", () => {
    const near = load(
      "a.wav=a か,10,375,-600,250,100\nb.wav=- か,10,375,-600,250,100\n"
    );
    const result = run({ kind: "preutter", value: 300 }, near);
    expect(kinds(result)).toStrictEqual(["error", "error"]);
    expect(result.otoSet).toBe(near);
    const continuous = transformParameters(
      near,
      all(near),
      { kind: "overlapThird" },
      {
        digits: 3,
        continuousOnly: true,
      }
    );
    expect(
      continuous.entries.map((entry) => entry.before?.alias)
    ).toStrictEqual(["a か"]);
    expect(() => run({ kind: "bpm", bpm: 0 })).toThrow("BPM");
  });
});

const options = (patch: Partial<ConversionOptions>): ConversionOptions => ({
  cv: true,
  cvSource: "all",
  vc: false,
  table: null,
  useTableConsonant: false,
  cvPreutter: 100,
  cvOverlap: 20,
  consonantLength: 100,
  shortenPlosive: false,
  allowDuplicates: false,
  ...patch,
});

describe("連続音からCV・VCを追加", () => {
  const table = SyllableTable.parse("か,k,a,80,100,20\nきゃ,ky,a,60,90,10\n");

  it("先行発声と終端の位置を保ったCVを作る", () => {
    const source = load("a.wav=a か,1000,375,-600,250,100\n");
    const withTable = convertVoicebank(
      source,
      all(source),
      options({ table, useTableConsonant: true })
    );
    expect(texts(withTable.otoSet)).toStrictEqual([
      "a.wav=a か,1000,375,-600,250,100",
      "a.wav=か,1150,180,-450,100,20",
    ]);
    const keepConsonant = convertVoicebank(
      source,
      all(source),
      options({ table })
    );
    expect(texts(keepConsonant.otoSet)[1]).toBe(
      "a.wav=か,1150,225,-450,100,20"
    );
  });

  it("子音の長さだけ前へ移したVCを作り、破裂音は子音の前半で終える", () => {
    const source = load("a.wav=a か,1000,375,-600,250,100\n");
    const normal = convertVoicebank(
      source,
      all(source),
      options({ cv: false, vc: true, table })
    );
    expect(texts(normal.otoSet)[1]).toBe(
      "a.wav=a k,900,283.333,-350,250,83.333"
    );
    const short = convertVoicebank(
      source,
      all(source),
      options({ cv: false, vc: true, table, shortenPlosive: true })
    );
    expect(texts(short.otoSet)[1]).toBe(
      "a.wav=a k,900,266.667,-300,250,83.333"
    );
  });

  it("装飾を保ち、語頭の行をCVの元に優先する", () => {
    const source = load(
      "a.wav=a きゃ_強,1000,375,-600,250,100\n" +
        "b.wav=- きゃ_強,500,200,-400,150,50\n" +
        "c.wav=a k,0,0,0,0,0\n" +
        "d.wav=a 息,0,0,0,0,0\n"
    );
    const result = convertVoicebank(
      source,
      all(source),
      options({ vc: true, consonantLength: 80 })
    );
    expect(texts(result.otoSet).slice(4)).toStrictEqual([
      "b.wav=きゃ_強,550,150,-350,100,20",
      "a.wav=a ky_強,920,276.667,-330,250,83.333",
    ]);
    expect(kinds(result)).toStrictEqual(["add", "skip", "add"]);
  });

  it("表にない音節は作らず、語頭だけを元にもできる", () => {
    const source = load(
      "a.wav=a さ,1000,375,-600,250,100\n" +
        "b.wav=- さ,1000,375,-600,250,100\n" +
        "c.wav=- か,1000,375,-600,250,100\n"
    );
    const result = convertVoicebank(
      source,
      all(source),
      options({ table, cvSource: "initial" })
    );
    expect(kinds(result)).toStrictEqual(["skip", "add"]);
    expect(result.entries[0]?.note).toBe("音節表にない音節です");
  });
});
