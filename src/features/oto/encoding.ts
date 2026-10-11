import Encoding from "encoding-japanese";

/**
 * oto.iniの文字コード。Shift_JIS系はWHATWG Encodingの`shift_jis`（Windows-31J相当）として扱う。
 */
export type OtoEncoding = "utf-8" | "shift_jis";

/** 利用者に表示する名前はIANAのCharacter Sets登録名に合わせる。 */
export const ENCODING_LABELS: Record<OtoEncoding, string> = {
  shift_jis: "Shift_JIS",
  // oxlint-disable-next-line unicorn/text-encoding-identifier-case -- APIの識別子ではなく、IANAの登録名を画面に表示する。
  "utf-8": "UTF-8",
};

export interface EncodingGuess {
  encoding: OtoEncoding;
  /** BOMを含むUTF-8のとき先頭3バイト。それ以外は空。 */
  bom: Uint8Array<ArrayBuffer>;
  /** 判定の根拠。ASCIIのみなど、どちらとも読める場合はambiguous。 */
  certainty: "bom" | "valid" | "ambiguous" | "invalid";
}

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

const canDecode = (bytes: Uint8Array, encoding: OtoEncoding): boolean => {
  try {
    new TextDecoder(encoding, { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

const hasNonAscii = (bytes: Uint8Array): boolean =>
  bytes.some((byte) => byte >= 0x80);

/**
 * バイト列から文字コードを推定する。UTF-8として正しく、非ASCIIを含むならUTF-8。
 * UTF-8として壊れていればShift_JIS。ASCIIのみはUTAU互換を優先してShift_JISとし、曖昧と報告する。
 */
export const guessEncoding = (bytes: Uint8Array): EncodingGuess => {
  if (
    bytes.length >= 3 &&
    bytes[0] === UTF8_BOM[0] &&
    bytes[1] === UTF8_BOM[1] &&
    bytes[2] === UTF8_BOM[2]
  ) {
    return { bom: bytes.slice(0, 3), certainty: "bom", encoding: "utf-8" };
  }
  if (!hasNonAscii(bytes)) {
    return {
      bom: new Uint8Array(),
      certainty: "ambiguous",
      encoding: "shift_jis",
    };
  }
  if (canDecode(bytes, "utf-8")) {
    return { bom: new Uint8Array(), certainty: "valid", encoding: "utf-8" };
  }
  if (canDecode(bytes, "shift_jis")) {
    return { bom: new Uint8Array(), certainty: "valid", encoding: "shift_jis" };
  }
  return { bom: new Uint8Array(), certainty: "invalid", encoding: "shift_jis" };
};

export const decodeBytes = (bytes: Uint8Array, encoding: OtoEncoding): string =>
  new TextDecoder(encoding).decode(bytes);

export class UnencodableError extends Error {
  readonly characters: string[];

  constructor(characters: string[], encoding: OtoEncoding) {
    super(
      `${ENCODING_LABELS[encoding]}で表せない文字があります: ${characters.join(" ")}`
    );
    this.name = "UnencodableError";
    this.characters = characters;
  }
}

/**
 * Shift_JISへの変換はencoding-japaneseを使う。読み込みはWHATWGのデコーダーなので、
 * 変換結果を読み戻して元の文字と一致しない文字も表せない文字として扱い、保存後に別の文字へ化けるのを防ぐ。
 */
const roundTripShiftJis = (text: string): Uint8Array | null => {
  try {
    const bytes = Uint8Array.from(
      Encoding.convert(Encoding.stringToCode(text), {
        fallback: "error",
        from: "UNICODE",
        to: "SJIS",
        type: "array",
      })
    );
    return decodeBytes(bytes, "shift_jis") === text ? bytes : null;
  } catch {
    return null;
  }
};

const encodeShiftJis = (text: string): Uint8Array => {
  const bytes = roundTripShiftJis(text);
  if (bytes === null) {
    const failed = new Set<string>();
    for (const char of text) {
      if (roundTripShiftJis(char) === null) {
        failed.add(char);
      }
    }
    throw new UnencodableError([...failed], "shift_jis");
  }
  return bytes;
};

/** 文字列を指定の文字コードへ変換する。表せない文字があればUnencodableErrorを投げ、文字を置き換えない。 */
export const encodeText = (text: string, encoding: OtoEncoding): Uint8Array => {
  if (encoding === "utf-8") {
    return new TextEncoder().encode(text);
  }
  return encodeShiftJis(text);
};

/** 入力中の文字列が保存できるかを確かめる。表せない文字の一覧を返す。 */
export const findUnencodable = (
  text: string,
  encoding: OtoEncoding
): string[] => {
  try {
    encodeText(text, encoding);
    return [];
  } catch (error) {
    if (error instanceof UnencodableError) {
      return error.characters;
    }
    throw error;
  }
};
