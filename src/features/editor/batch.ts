import type { Oto, OtoLine, OtoSet, ParsedOtoLine } from "../oto/oto-set";
import { isOtoLine } from "../oto/oto-set";

export type BatchScope = "all" | "visible" | "selection";

export interface BatchEntry {
  kind: "add" | "change" | "delete" | "skip" | "error";
  lineId: string;
  before: Oto | null;
  after: Oto | null;
  note: string;
}

export interface BatchResult {
  base: OtoSet;
  otoSet: OtoSet;
  entries: BatchEntry[];
}

export const CONTINUOUS_ALIAS = /^(?<lead>[aiueonN-]) (?<body>.+)$/u;

export const SMALL_KANA = "ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ";

const SPECIAL = /[.*+?^${}()|[\]\\/]/gu;
export const literalPattern = (text: string): string =>
  text.replaceAll(SPECIAL, String.raw`\$&`);

export const aliasProblem = (alias: string): string => {
  if (alias === "") {
    return "エイリアスが空になります";
  }
  if (/[,\r\n]/u.test(alias)) {
    return "エイリアスにカンマか改行が入ります";
  }
  return "";
};

export const targetLines = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>
): ParsedOtoLine[] =>
  otoSet.lines.filter(
    (line): line is ParsedOtoLine => ids.has(line.id) && isOtoLine(line)
  );

export const appendLines = (otoSet: OtoSet, lines: OtoLine[]): OtoSet =>
  lines.length === 0
    ? otoSet
    : { ...otoSet, lines: [...otoSet.lines, ...lines] };

export const deleteLines = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>,
  allowLastRow: boolean
): BatchResult => {
  const remaining = new Map<string, number>();
  for (const line of otoSet.lines) {
    if (isOtoLine(line)) {
      const wav = line.parsed.oto.wav.toLowerCase();
      remaining.set(wav, (remaining.get(wav) ?? 0) + 1);
    }
  }
  const entries: BatchEntry[] = [];
  const removed = new Set<string>();
  for (const line of otoSet.lines.toReversed()) {
    if (!ids.has(line.id)) {
      continue;
    }
    if (!isOtoLine(line)) {
      removed.add(line.id);
      entries.push({
        kind: "delete",
        lineId: line.id,
        before: null,
        after: null,
        note: line.text,
      });
      continue;
    }
    const { oto } = line.parsed;
    const wav = oto.wav.toLowerCase();
    const count = remaining.get(wav) ?? 0;
    const last = count <= 1;
    if (last && !allowLastRow) {
      entries.push({
        kind: "skip",
        lineId: line.id,
        before: oto,
        after: null,
        note: "このWAVの最後の行です",
      });
      continue;
    }
    remaining.set(wav, count - 1);
    removed.add(line.id);
    entries.push({
      kind: "delete",
      lineId: line.id,
      before: oto,
      after: null,
      note: last ? "このWAVの原音設定がなくなります" : "",
    });
  }
  entries.reverse();
  return {
    base: otoSet,
    otoSet:
      removed.size === 0
        ? otoSet
        : {
            ...otoSet,
            lines: otoSet.lines.filter((line) => !removed.has(line.id)),
          },
    entries,
  };
};

export const countEntries = (
  entries: readonly BatchEntry[]
): Record<BatchEntry["kind"], number> => {
  const counts = { add: 0, change: 0, delete: 0, skip: 0, error: 0 };
  for (const entry of entries) {
    counts[entry.kind] += 1;
  }
  return counts;
};
