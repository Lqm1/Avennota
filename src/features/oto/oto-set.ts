import type { EncodingGuess, OtoEncoding } from "./encoding";
import {
  decodeBytes,
  encodeText,
  guessEncoding,
  UnencodableError,
} from "./encoding";

export type Eol = "\r\n" | "\n" | "\r" | "";

/** oto.iniの記述順。左ブランク、固定範囲、右ブランク、先行発声、オーバーラップ。 */
export const PARAM_KEYS = [
  "offset",
  "consonant",
  "cutoff",
  "preutter",
  "overlap",
] as const;
export type ParamKey = (typeof PARAM_KEYS)[number];
export type OtoParams = Record<ParamKey, number>;
const ZERO_PARAMS: Readonly<OtoParams> = Object.freeze({
  offset: 0,
  consonant: 0,
  cutoff: 0,
  preutter: 0,
  overlap: 0,
});

/**
 * 原音設定行の内容。名前はOpenUTAUのOtoクラス（Wav, Alias, Offset, Consonant, Cutoff, Preutter, Overlap）に合わせる。
 */
export interface Oto extends OtoParams {
  /** `=`より前の原音ファイル名。フォルダからの相対名で、元の表記を保つ。 */
  wav: string;
  alias: string;
  /** 実際に記述されていた数値欄。欠けた欄は配列に含めない。 */
  paramTexts: string[];
  /** 6欄目より後ろに続く欄。解釈せず保持する。 */
  extra: string[];
}

export type ParsedLine =
  | { kind: "blank" }
  | { kind: "unparsed"; reason: string }
  | { kind: "oto"; oto: Oto; issues: string[] };

export interface LineSource {
  text: string;
  raw: Uint8Array<ArrayBuffer>;
  eol: Eol;
}

export interface OtoLine<P extends ParsedLine = ParsedLine> {
  comment?: string;
  /** ドキュメント内で一意な識別子。行順の変化や重複エイリアスがあっても変わらない。 */
  id: string;
  text: string;
  /** 読み込んだ行の元データ。新しい行には存在しない。 */
  source: LineSource | null;
  parsed: P;
}

export type ParsedOtoLine = OtoLine<Extract<ParsedLine, { kind: "oto" }>>;
export type UnparsedOtoLine = OtoLine<
  Extract<ParsedLine, { kind: "unparsed" }>
>;
export const isOtoLine = (line: OtoLine): line is ParsedOtoLine =>
  line.parsed.kind === "oto";
export const isUnparsedLine = (line: OtoLine): line is UnparsedOtoLine =>
  line.parsed.kind === "unparsed";

export interface OtoSet {
  encoding: OtoEncoding;
  encodingCertainty: EncodingGuess["certainty"];
  bom: Uint8Array<ArrayBuffer>;
  lines: OtoLine[];
  /** 最終行の後ろに改行があるか。 */
  trailingEol: boolean;
  /** 新しい行や位置が変わった行に使う改行コード。 */
  eol: Exclude<Eol, "">;
}

let lineCounter = 0;
export const createLineId = (): string => {
  lineCounter += 1;
  return `l${lineCounter.toString(36)}`;
};

const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

export const PARAM_LABELS: Record<ParamKey, string> = {
  consonant: "固定範囲",
  cutoff: "右ブランク",
  offset: "左ブランク",
  overlap: "オーバーラップ",
  preutter: "先行発声",
};

/** 1行を解釈する。空の数値欄はUTAUと同じく0として扱い、元の空欄表記は保持する。 */
export const parseLine = (text: string): ParsedLine => {
  if (text.trim() === "") {
    return { kind: "blank" };
  }
  const separator = text.indexOf("=");
  if (separator === -1) {
    return {
      kind: "unparsed",
      reason: "「=」がないため原音設定行として解釈できません",
    };
  }
  const wav = text.slice(0, separator);
  if (wav.trim() === "") {
    return { kind: "unparsed", reason: "WAVファイル名が指定されていません" };
  }
  const fields = text.slice(separator + 1).split(",");
  const issues: string[] = [];
  const paramTexts = fields.slice(1, PARAM_KEYS.length + 1);
  const oto: Oto = {
    ...ZERO_PARAMS,
    alias: fields[0] ?? "",
    extra: fields.slice(PARAM_KEYS.length + 1),
    paramTexts,
    wav,
  };
  for (const [index, key] of PARAM_KEYS.entries()) {
    const fieldText = fields[index + 1];
    const trimmed = fieldText?.trim() ?? "";
    if (trimmed === "") {
      continue;
    }
    if (NUMBER_PATTERN.test(trimmed)) {
      oto[key] = Number(trimmed);
    } else {
      oto[key] = Number.NaN;
      issues.push(`${PARAM_LABELS[key]}が数値ではありません（${trimmed}）`);
    }
  }
  return {
    oto,
    issues,
    kind: "oto",
  };
};

/** ミリ秒値を小数第3位までの短い表記にする。 */
export const formatNumber = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000;
  if (rounded === 0) {
    return "0";
  }
  return String(rounded);
};

export const formatOto = (oto: Oto): string => {
  const numbers = PARAM_KEYS.map((key, index) => {
    const original = oto.paramTexts[index];
    return original ?? formatNumber(oto[key]);
  });
  return `${oto.wav}=${[oto.alias, ...numbers, ...oto.extra].join(",")}`;
};

/** 原音設定値を変更した欄だけ表記を作り直し、それ以外の欄の表記は保つ。 */
export const withParams = (oto: Oto, changes: Partial<OtoParams>): Oto => {
  let next = oto;
  for (const [index, key] of PARAM_KEYS.entries()) {
    const value = changes[key];
    if (value === undefined || Object.is(value, oto[key])) {
      continue;
    }
    if (next === oto) {
      next = { ...oto, paramTexts: [...oto.paramTexts] };
    }
    next[key] = Math.round(value * 1000) / 1000;
    while (next.paramTexts.length <= index) {
      next.paramTexts.push("0");
    }
    next.paramTexts[index] = formatNumber(value);
  }
  return next;
};

const splitLines = (bytes: Uint8Array): { content: Uint8Array; eol: Eol }[] => {
  const lines: { content: Uint8Array; eol: Eol }[] = [];
  let start = 0;
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index];
    if (byte === 0x0d || byte === 0x0a) {
      const crlf = byte === 0x0d && bytes[index + 1] === 0x0a;
      let eol: Eol = "\n";
      if (crlf) {
        eol = "\r\n";
      } else if (byte === 0x0d) {
        eol = "\r";
      }
      lines.push({ content: bytes.subarray(start, index), eol });
      index += crlf ? 2 : 1;
      start = index;
    } else {
      index += 1;
    }
  }
  if (start < bytes.length) {
    lines.push({ content: bytes.subarray(start), eol: "" });
  }
  return lines;
};

const mostCommonEol = (eols: Eol[]): Exclude<Eol, ""> => {
  const counts = new Map<Exclude<Eol, "">, number>();
  for (const eol of eols) {
    if (eol !== "") {
      counts.set(eol, (counts.get(eol) ?? 0) + 1);
    }
  }
  let best: Exclude<Eol, ""> = "\r\n";
  let bestCount = 0;
  for (const [eol, count] of counts) {
    if (count > bestCount) {
      best = eol;
      bestCount = count;
    }
  }
  return best;
};

export const createLine = (text: string): OtoLine => ({
  id: createLineId(),
  parsed: parseLine(text),
  source: null,
  text,
});

/**
 * バイト列からoto.iniを読む。行はバイト単位で分割し、各行の元のバイト列と改行を保持する。
 * CRとLFはShift_JISの2バイト目に現れないため、文字コードの判定前に分割できる。
 */
export const parseOto = (bytes: Uint8Array, encoding?: OtoEncoding): OtoSet => {
  const guess = guessEncoding(bytes);
  const chosen = encoding ?? guess.encoding;
  const bom = chosen === "utf-8" ? guess.bom : new Uint8Array();
  const body = bytes.subarray(bom.length);
  const parts = splitLines(body);
  const lines = parts.map((part): OtoLine => {
    const text = decodeBytes(part.content, chosen);
    return {
      id: createLineId(),
      text,
      parsed: parseLine(text),
      source: { text, raw: Uint8Array.from(part.content), eol: part.eol },
    };
  });
  const last = parts.at(-1);
  return {
    bom: Uint8Array.from(bom),
    encoding: chosen,
    encodingCertainty: encoding ? "valid" : guess.certainty,
    eol: mostCommonEol(parts.map((part) => part.eol)),
    lines,
    trailingEol: last ? last.eol !== "" : true,
  };
};

/** 新規のoto.ini。UTAUで一般的なShift_JIS・CRLFを使う。 */
export const createEmptyOtoSet = (): OtoSet => ({
  bom: new Uint8Array(),
  encoding: "shift_jis",
  encodingCertainty: "valid",
  eol: "\r\n",
  lines: [],
  trailingEol: true,
});

export interface SerializeIssue {
  lineId: string;
  characters: string[];
}

export type SerializeResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; issues: SerializeIssue[] };

/** ドキュメントをバイト列へ戻す。未編集の行は元のバイト列と改行をそのまま使う。 */
export const serializeOto = (otoSet: OtoSet): SerializeResult => {
  const chunks: Uint8Array[] = [otoSet.bom];
  const issues: SerializeIssue[] = [];
  const eolCache = new Map<string, Uint8Array>();
  const eolBytes = (eol: Eol): Uint8Array => {
    let cached = eolCache.get(eol);
    if (!cached) {
      cached = encodeText(eol, otoSet.encoding);
      eolCache.set(eol, cached);
    }
    return cached;
  };
  const lastIndex = otoSet.lines.length - 1;
  for (const [index, line] of otoSet.lines.entries()) {
    const { source } = line;
    if (source !== null && line.text === source.text) {
      chunks.push(source.raw);
    } else {
      try {
        chunks.push(encodeText(line.text, otoSet.encoding));
      } catch (error) {
        if (error instanceof UnencodableError) {
          issues.push({ characters: error.characters, lineId: line.id });
          continue;
        }
        throw error;
      }
    }
    const ownEol =
      source === null || source.eol === "" ? otoSet.eol : source.eol;
    if (index < lastIndex || otoSet.trailingEol) {
      chunks.push(eolBytes(ownEol));
    }
  }
  if (issues.length > 0) {
    return { issues, ok: false };
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, ok: true };
};

/**
 * 解釈する文字コードを切り替える。読み込んだままの行は元のバイト列から読み直し、編集済みの行は文字列を保つ。
 */
export const reinterpretEncoding = (
  otoSet: OtoSet,
  encoding: OtoEncoding
): OtoSet => {
  if (otoSet.encoding === encoding) {
    return otoSet;
  }
  const lines = otoSet.lines.map((line) => {
    const { source } = line;
    if (source === null || line.text !== source.text) {
      return line;
    }
    const text = decodeBytes(source.raw, encoding);
    return {
      ...line,
      source: { ...source, text },
      parsed: parseLine(text),
      text,
    };
  });
  return { ...otoSet, encoding, encodingCertainty: "valid", lines };
};

export const replaceLine = (
  otoSet: OtoSet,
  lineId: string,
  update: (line: OtoLine) => OtoLine
): OtoSet => {
  const index = otoSet.lines.findIndex((line) => line.id === lineId);
  const current = otoSet.lines[index];
  if (current === undefined) {
    return otoSet;
  }
  const next = update(current);
  if (next === current) {
    return otoSet;
  }
  const lines = [...otoSet.lines];
  lines[index] = next;
  return { ...otoSet, lines };
};

export const setLineText = (line: OtoLine, text: string): OtoLine =>
  text === line.text ? line : { ...line, parsed: parseLine(text), text };

export const setLineOto = (line: OtoLine, oto: Oto): OtoLine =>
  line.parsed.kind === "oto" && line.parsed.oto === oto
    ? line
    : setLineText(line, formatOto(oto));

export const insertLines = (
  otoSet: OtoSet,
  index: number,
  lines: OtoLine[]
): OtoSet => {
  const next = [...otoSet.lines];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, ...lines);
  return { ...otoSet, lines: next };
};

export const removeLine = (otoSet: OtoSet, lineId: string): OtoSet => {
  const lines = otoSet.lines.filter((line) => line.id !== lineId);
  return lines.length === otoSet.lines.length ? otoSet : { ...otoSet, lines };
};

export const createOtoLine = (
  wav: string,
  alias: string,
  params: OtoParams = ZERO_PARAMS
): OtoLine => {
  const oto: Oto = {
    ...params,
    alias,
    extra: [],
    paramTexts: PARAM_KEYS.map((key) => formatNumber(params[key])),
    wav,
  };
  return createLine(formatOto(oto));
};

/** 拡張子を除いたファイル名。UTAUではエイリアスが空の行をこの名前で呼ぶ。 */
export const fileStem = (wav: string): string => {
  const base = wav.split(/[\\/]/u).at(-1) ?? wav;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};

export const effectiveAlias = (oto: Oto): string =>
  oto.alias || fileStem(oto.wav);

export const aliasCounts = (otoSet: OtoSet): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const line of otoSet.lines) {
    if (isOtoLine(line)) {
      const alias = effectiveAlias(line.parsed.oto);
      counts.set(alias, (counts.get(alias) ?? 0) + 1);
    }
  }
  return counts;
};

export const copyLine = (source: OtoLine, text = source.text): OtoLine => ({
  ...createLine(text),
  comment: source.comment,
});
