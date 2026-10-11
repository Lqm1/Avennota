import { describe, expect, it } from "vitest";

import { encodeText, findUnencodable, guessEncoding } from "./encoding";
import {
  createOtoLine,
  formatNumber,
  insertLines,
  parseOto,
  reinterpretEncoding,
  removeLine,
  replaceLine,
  serializeOto,
  setLineOto,
  withParams,
} from "./oto-set";
import type { OtoSet } from "./oto-set";

const sjis = (text: string): Uint8Array => encodeText(text, "shift_jis");
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const serializedBytes = (otoSet: OtoSet): Uint8Array => {
  const result = serializeOto(otoSet);
  if (!result.ok) {
    throw new Error("serialize failed");
  }
  return result.bytes;
};

const roundTrip = (bytes: Uint8Array): Uint8Array =>
  serializedBytes(parseOto(bytes));

const firstOtoLine = (otoSet: OtoSet) => {
  const line = otoSet.lines.find(
    (candidate) => candidate.parsed.kind === "oto"
  );
  if (!line || line.parsed.kind !== "oto") {
    throw new Error("no oto");
  }
  return { oto: line.parsed.oto, line };
};

const decodeSjis = (bytes: Uint8Array): string =>
  new TextDecoder("shift_jis").decode(bytes);

describe("文字コード", () => {
  it("Shift_JISの日本語を判定する", () => {
    expect(guessEncoding(sjis("あ.wav=- あ,10,20,-30,40,5\r\n")).encoding).toBe(
      "shift_jis"
    );
  });

  it("UTF-8の日本語を判定する", () => {
    expect(guessEncoding(utf8("あ.wav=- あ,10,20,-30,40,5\n")).encoding).toBe(
      "utf-8"
    );
  });

  it("ASCIIのみは曖昧と報告する", () => {
    expect(guessEncoding(utf8("a.wav=a,1,2,3,4,5\n")).certainty).toBe(
      "ambiguous"
    );
  });

  it("Shift_JISで表せない文字を置き換えず失敗する", () => {
    expect(() => encodeText("🎵", "shift_jis")).toThrow(
      /Shift_JISで表せない文字/u
    );
  });

  it("Shift_JISの機種依存文字と半角カナを往復する", () => {
    const text = "①ｱｲｳ髙﨑～";
    expect(decodeSjis(encodeText(text, "shift_jis"))).toBe(text);
  });

  it("読み戻すと別の文字になる文字はShift_JISで表せない文字として報告する", () => {
    expect(findUnencodable("あ−い", "shift_jis")).toStrictEqual(["−"]);
  });
});

describe("往復", () => {
  const cases: [string, Uint8Array][] = [
    [
      "Shift_JIS・CRLF",
      sjis("_あ.wav=- あ,10,20,-30.5,40,5\r\n_あ.wav=あ R,100,20,30,40,-5\r\n"),
    ],
    [
      "UTF-8・LF・末尾改行なし",
      utf8("か.wav=- か,1,2,3,4,5\nか.wav=か,1,2,3,4,5"),
    ],
    [
      "UTF-8 BOM",
      new Uint8Array([
        0xef,
        0xbb,
        0xbf,
        ...utf8("さ.wav=さ,1.000,2.50,3,4,5\r\n"),
      ]),
    ],
    [
      "改行混在と空行",
      utf8("a.wav=a,1,2,3,4,5\r\n\nb.wav=b,1,2,3,4,5\rc.wav\n"),
    ],
    [
      "未解釈行と不正な数値",
      sjis("; コメント\r\nx.wav=x,abc,1,2,3,4\r\n存在しない.wav=,,,,,\r\n"),
    ],
    ["余分な欄", utf8("a.wav=a,1,2,3,4,5,extra,more\n")],
    ["空ファイル", new Uint8Array()],
    ["改行だけ", utf8("\r\n\r\n")],
  ];

  it.each(cases)("未編集ならバイト一致する: %s", (_name, bytes) => {
    expect(roundTrip(bytes)).toStrictEqual(bytes);
  });

  it("不正なバイト列を含む行も未編集なら保持する", () => {
    const bytes = new Uint8Array([
      ...utf8("a.wav=a,1,2,3,4,5\r\n"),
      0x82,
      0xff,
      0x0d,
      0x0a,
    ]);
    expect(roundTrip(bytes)).toStrictEqual(bytes);
  });
});

describe("解釈", () => {
  it("正負の右ブランクと負のオーバーラップを補正しない", () => {
    const otoSet = parseOto(
      sjis("a.wav=a,10,20,-30,40,-5\r\nb.wav=b,10,20,30,40,5\r\n")
    );
    const otos = otoSet.lines.map((line) =>
      line.parsed.kind === "oto" ? line.parsed.oto : null
    );
    expect(otos[0]).toMatchObject({
      consonant: 20,
      cutoff: -30,
      offset: 10,
      overlap: -5,
      preutter: 40,
      wav: "a.wav",
    });
    expect(otos[1]?.cutoff).toBe(30);
  });

  it("重複エイリアスを別の行として保持する", () => {
    const otoSet = parseOto(utf8("a.wav=a,1,2,3,4,5\na.wav=a,1,2,3,4,5\n"));
    expect(otoSet.lines).toHaveLength(2);
    expect(otoSet.lines[0]?.id).not.toBe(otoSet.lines[1]?.id);
  });

  it("不正な数値と未解釈行を識別する", () => {
    const otoSet = parseOto(utf8("x.wav=x,abc,1,2,3,4\njunk\n\n"));
    const [invalid, junk, blank] = otoSet.lines;
    expect(invalid?.parsed.kind === "oto" && invalid.parsed.issues.length).toBe(
      1
    );
    expect(junk?.parsed.kind).toBe("unparsed");
    expect(blank?.parsed.kind).toBe("blank");
  });
});

describe("編集", () => {
  it("変更した行だけを書き換え、他の行・改行・文字コードを保つ", () => {
    const source = sjis(
      "_あ.wav=- あ,10.000,20,-30,40,5\r\n_い.wav=- い,1,2,3,4,5\r\n"
    );
    const otoSet = parseOto(source);
    const { oto, line } = firstOtoLine(otoSet);
    const edited = replaceLine(otoSet, line.id, (current) =>
      setLineOto(current, withParams(oto, { preutter: 45.25 }))
    );
    expect(decodeSjis(serializedBytes(edited))).toBe(
      "_あ.wav=- あ,10.000,20,-30,45.25,5\r\n_い.wav=- い,1,2,3,4,5\r\n"
    );
  });

  it("エイリアスの変更を保存できる", () => {
    const otoSet = parseOto(utf8("a.wav=a,1,2,3,4,5\n"));
    const { oto, line } = firstOtoLine(otoSet);
    const edited = replaceLine(otoSet, line.id, (current) =>
      setLineOto(current, { ...oto, alias: "a2" })
    );
    const result = serializeOto(edited);
    expect(result.ok && new TextDecoder().decode(result.bytes)).toBe(
      "a.wav=a2,1,2,3,4,5\n"
    );
  });

  it("末尾改行のないファイルへ行を追加すると前の行に既定のCRLFを補う", () => {
    const otoSet = parseOto(utf8("a.wav=a,1,2,3,4,5"));
    const added = insertLines(otoSet, 1, [createOtoLine("b.wav", "b")]);
    const result = serializeOto(added);
    expect(result.ok && new TextDecoder().decode(result.bytes)).toBe(
      "a.wav=a,1,2,3,4,5\r\nb.wav=b,0,0,0,0,0"
    );
  });

  it("行を削除しても他の行のバイト列を保つ", () => {
    const otoSet = parseOto(
      sjis("a.wav=あ,1,2,3,4,5\r\nb.wav=い,1,2,3,4,5\r\n")
    );
    const removed = removeLine(otoSet, otoSet.lines[0]?.id ?? "");
    const result = serializeOto(removed);
    expect(result.ok && decodeSjis(result.bytes)).toBe(
      "b.wav=い,1,2,3,4,5\r\n"
    );
  });

  it("Shift_JISで表せないエイリアスは保存前に行を報告する", () => {
    const otoSet = parseOto(sjis("a.wav=あ,1,2,3,4,5\r\n"));
    const { oto, line } = firstOtoLine(otoSet);
    const edited = replaceLine(otoSet, line.id, (current) =>
      setLineOto(current, { ...oto, alias: "🎵" })
    );
    expect(serializeOto(edited)).toMatchObject({
      issues: [{ lineId: line.id }],
      ok: false,
    });
  });

  it("文字コードを読み替えると未編集行を元のバイト列から解釈し直す", () => {
    const bytes = sjis("a.wav=あ,1,2,3,4,5\r\n");
    const otoSet = parseOto(bytes, "utf-8");
    const reread = reinterpretEncoding(otoSet, "shift_jis");
    expect(firstOtoLine(reread).oto.alias).toBe("あ");
    const result = serializeOto(reread);
    expect(result.ok && result.bytes).toStrictEqual(bytes);
  });

  it("欠けた数値欄を書くときは前の欄を0で埋める", () => {
    const otoSet = parseOto(utf8("a.wav=a\n"));
    const { oto } = firstOtoLine(otoSet);
    expect(withParams(oto, { consonant: 12 }).paramTexts).toStrictEqual([
      "0",
      "12",
    ]);
  });

  it("数値表記は小数第3位までに丸める", () => {
    expect(formatNumber(1.23456)).toBe("1.235");
    expect(formatNumber(-0.0001)).toBe("0");
    expect(formatNumber(-30)).toBe("-30");
  });
});
