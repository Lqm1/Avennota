import type { Oto, OtoLine, OtoSet, ParsedOtoLine } from "../oto/oto-set";
import { copyLine, formatOto, isOtoLine, setLineOto } from "../oto/oto-set";

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

export class BatchBuilder {
  private readonly base: OtoSet;
  private readonly entries: BatchEntry[] = [];
  private readonly replaced = new Map<string, OtoLine>();
  private readonly added: OtoLine[] = [];
  private readonly removed = new Set<string>();

  constructor(base: OtoSet) {
    this.base = base;
  }

  change(line: ParsedOtoLine, after: Oto, note = ""): void {
    this.record("change", line, line.parsed.oto, after, note);
    this.replaced.set(line.id, setLineOto(line, after));
  }

  changeComment(line: ParsedOtoLine, comment: string, note: string): void {
    this.record("change", line, line.parsed.oto, line.parsed.oto, note);
    this.replaced.set(line.id, { ...line, comment });
  }

  add(source: ParsedOtoLine, after: Oto, note: string): void {
    this.record("add", source, source.parsed.oto, after, note);
    this.added.push(copyLine(source, formatOto(after)));
  }

  remove(line: OtoLine, note: string): void {
    const before = isOtoLine(line) ? line.parsed.oto : null;
    this.record("delete", line, before, null, note);
    this.removed.add(line.id);
  }

  skip(line: ParsedOtoLine, after: Oto | null, note: string): void {
    this.record("skip", line, line.parsed.oto, after, note);
  }

  error(line: ParsedOtoLine, after: Oto | null, note: string): void {
    this.record("error", line, line.parsed.oto, after, note);
  }

  build(): BatchResult {
    const { base, entries } = this;
    if (
      this.replaced.size === 0 &&
      this.added.length === 0 &&
      this.removed.size === 0
    ) {
      return { base, otoSet: base, entries };
    }
    const lines = base.lines
      .filter((line) => !this.removed.has(line.id))
      .map((line) => this.replaced.get(line.id) ?? line);
    return {
      base,
      otoSet: { ...base, lines: [...lines, ...this.added] },
      entries,
    };
  }

  private record(
    kind: BatchEntry["kind"],
    line: OtoLine,
    before: Oto | null,
    after: Oto | null,
    note: string
  ): void {
    this.entries.push({ kind, lineId: line.id, before, after, note });
  }
}

export const deleteLines = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>,
  allowLastRow: boolean
): BatchResult => {
  const kept = new Set<string>();
  for (const line of otoSet.lines) {
    if (isOtoLine(line) && !ids.has(line.id)) {
      kept.add(line.parsed.oto.wav.toLowerCase());
    }
  }
  const builder = new BatchBuilder(otoSet);
  for (const line of otoSet.lines) {
    if (!ids.has(line.id)) {
      continue;
    }
    if (!isOtoLine(line)) {
      builder.remove(line, line.text);
      continue;
    }
    const wav = line.parsed.oto.wav.toLowerCase();
    if (kept.has(wav)) {
      builder.remove(line, "");
      continue;
    }
    kept.add(wav);
    if (allowLastRow) {
      builder.remove(line, "このWAVの原音設定がなくなります");
    } else {
      builder.skip(line, null, "このWAVの最後の行です");
    }
  }
  return builder.build();
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
