import type { Durations } from "../audio/wav-cache";
import { findUnencodable } from "../oto/encoding";
import type { OtoEncoding } from "../oto/encoding";
import { paramWarnings, rangeWarnings } from "../oto/geometry";
import type {
  OtoLine,
  ParsedOtoLine,
  UnparsedOtoLine,
  OtoSet,
} from "../oto/oto-set";
import {
  aliasCounts as countAliases,
  effectiveAlias,
  fileStem,
  isOtoLine,
  isUnparsedLine,
} from "../oto/oto-set";

export type RowStatusTone = "error" | "warning" | "info";

export interface RowStatus {
  tone: RowStatusTone;
  text: string;
}

interface RowDetails extends Pick<OtoLine, "id"> {
  lineNumber: number;
  statuses: RowStatus[];
}
export type OtoRow = RowDetails &
  (
    | { kind: "oto"; line: ParsedOtoLine }
    | { kind: "unparsed"; line: UnparsedOtoLine }
  );
export type ParsedOtoRow = Extract<OtoRow, { kind: "oto" }>;

type DisplayLine = ParsedOtoLine | UnparsedOtoLine;

const isSubfolderPath = (wav: string): boolean => /[\\/]/u.test(wav);

const buildRow = (
  line: DisplayLine,
  index: number,
  encoding: OtoEncoding,
  wavs: Map<string, string>,
  durations: Durations,
  aliasCounts: Map<string, number>
): OtoRow => {
  const statuses: RowStatus[] = [];
  const edited = line.source === null || line.text !== line.source.text;
  if (edited) {
    const characters = findUnencodable(line.text, encoding);
    if (characters.length > 0) {
      statuses.push({
        text: `保存できない文字: ${characters.join(" ")}`,
        tone: "error",
      });
    }
  }
  if (isUnparsedLine(line)) {
    statuses.push({ text: `未解釈: ${line.parsed.reason}`, tone: "warning" });
    return {
      kind: "unparsed",
      line,
      id: line.id,
      lineNumber: index + 1,
      statuses,
    };
  }
  const { oto, issues } = line.parsed;
  for (const issue of issues) {
    statuses.push({ text: issue, tone: "error" });
  }
  const wavKey = oto.wav.toLowerCase();
  if (isSubfolderPath(oto.wav)) {
    statuses.push({
      text: "子フォルダのWAV（このフォルダを個別に開いて編集）",
      tone: "info",
    });
  } else if (!wavs.has(wavKey)) {
    statuses.push({ text: "WAVがありません", tone: "warning" });
  }
  if ((aliasCounts.get(effectiveAlias(oto)) ?? 0) > 1) {
    statuses.push({ text: "エイリアスが重複", tone: "info" });
  }
  const duration = durations.get(wavKey);
  const warnings =
    duration === undefined ? paramWarnings(oto) : rangeWarnings(oto, duration);
  for (const warning of warnings) {
    statuses.push({ text: warning, tone: "warning" });
  }
  return { kind: "oto", line, id: line.id, lineNumber: index + 1, statuses };
};

/**
 * 行の内容と表示に関わる条件が変わらなければ、前回と同じ行オブジェクトを返す。
 * React AriaのTableは行オブジェクトが同じなら描画を省くため、ドラッグ中も変更した行だけが描き直される。
 */
const rowCache = new WeakMap<OtoLine, { key: string; row: OtoRow }>();

const cachedRow = (
  line: DisplayLine,
  index: number,
  encoding: OtoEncoding,
  wavs: Map<string, string>,
  durations: Durations,
  aliasCounts: Map<string, number>
): OtoRow => {
  let key = `${index}|${encoding}`;
  if (line.parsed.kind === "oto") {
    const { oto } = line.parsed;
    const wavKey = oto.wav.toLowerCase();
    const duplicated = (aliasCounts.get(effectiveAlias(oto)) ?? 0) > 1;
    key += `|${wavs.has(wavKey)}|${durations.get(wavKey) ?? ""}|${duplicated}`;
  }
  const cached = rowCache.get(line);
  if (cached?.key === key) {
    return cached.row;
  }
  const row = buildRow(line, index, encoding, wavs, durations, aliasCounts);
  rowCache.set(line, { key, row });
  return row;
};

export const buildRows = (
  otoSet: OtoSet,
  wavs: Map<string, string>,
  durations: Durations
): OtoRow[] => {
  const aliasCounts = countAliases(otoSet);
  const rows: OtoRow[] = [];
  for (const [index, line] of otoSet.lines.entries()) {
    if (!isOtoLine(line) && !isUnparsedLine(line)) {
      continue;
    }
    rows.push(
      cachedRow(line, index, otoSet.encoding, wavs, durations, aliasCounts)
    );
  }
  return rows;
};

export const rowMatches = (row: OtoRow, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return false;
  }
  const texts =
    row.kind === "oto"
      ? [
          row.line.parsed.oto.alias,
          fileStem(row.line.parsed.oto.wav),
          row.line.parsed.oto.wav,
        ]
      : [row.line.text];
  return texts.some((text) => text.toLowerCase().includes(needle));
};
