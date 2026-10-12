import type { OtoLine, OtoSet } from "../oto/oto-set";
import { isOtoLine, setLineOto } from "../oto/oto-set";
import {
  aliasProblem,
  effectiveAlias,
  literalPattern,
  SMALL_KANA,
} from "./batch";
import type { BatchEntry, BatchResult } from "./batch";

export type QueryField = "alias" | "wav" | "comment" | "text";
export type QueryMode = "contains" | "exact" | "regex";

export interface RowQuery {
  field: QueryField;
  mode: QueryMode;
  text: string;
  ignoreCase: boolean;
  excludeYoon: boolean;
}

export const queryPattern = (query: RowQuery, global = false): RegExp => {
  if (query.text === "") {
    throw new Error("検索する文字列を入力してください。");
  }
  const flags = `u${query.ignoreCase ? "i" : ""}${global ? "g" : ""}`;
  if (query.mode === "regex") {
    return new RegExp(query.text, flags);
  }
  const literal = literalPattern(query.text);
  if (query.mode === "exact") {
    return new RegExp(`^${literal}$`, flags);
  }
  return new RegExp(
    query.excludeYoon ? `${literal}(?![${SMALL_KANA}])` : literal,
    flags
  );
};

const fieldValue = (line: OtoLine, field: QueryField): string | null => {
  if (line.parsed.kind === "blank") {
    return null;
  }
  if (field === "text") {
    return line.text;
  }
  if (!isOtoLine(line)) {
    return null;
  }
  if (field === "comment") {
    return line.comment ?? "";
  }
  return field === "wav"
    ? line.parsed.oto.wav
    : effectiveAlias(line.parsed.oto);
};

export const findMatches = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>,
  query: RowQuery
): string[] => {
  const pattern = queryPattern(query);
  return otoSet.lines.flatMap((line) => {
    const value = ids.has(line.id) ? fieldValue(line, query.field) : null;
    return value !== null && pattern.test(value) ? [line.id] : [];
  });
};

export const replaceMatches = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>,
  query: RowQuery,
  replacement: string,
  all: boolean
): BatchResult => {
  if (query.field !== "alias" && query.field !== "comment") {
    throw new Error("置換できるのはエイリアスとコメントです。");
  }
  const regex = query.mode === "regex";
  const pattern = queryPattern(query, all || !regex);
  const entries: BatchEntry[] = [];
  const lines = otoSet.lines.map((line) => {
    const value = ids.has(line.id) ? fieldValue(line, query.field) : null;
    if (value === null || !isOtoLine(line)) {
      return line;
    }
    const next = regex
      ? value.replace(pattern, replacement)
      : value.replace(pattern, () => replacement);
    if (next === value) {
      return line;
    }
    const { oto } = line.parsed;
    if (query.field === "comment") {
      if (/[\r\n]/u.test(next)) {
        entries.push({
          kind: "error",
          lineId: line.id,
          before: oto,
          after: null,
          note: "コメントに改行が入ります",
        });
        return line;
      }
      entries.push({
        kind: "change",
        lineId: line.id,
        before: oto,
        after: oto,
        note: `コメント: ${value} → ${next}`,
      });
      return { ...line, comment: next };
    }
    const after = { ...oto, alias: next };
    const problem = aliasProblem(next);
    entries.push({
      kind: problem === "" ? "change" : "error",
      lineId: line.id,
      before: oto,
      after,
      note: problem,
    });
    return problem === "" ? setLineOto(line, after) : line;
  });
  return {
    base: otoSet,
    otoSet: entries.some((entry) => entry.kind === "change")
      ? { ...otoSet, lines }
      : otoSet,
    entries,
  };
};

export const extractLines = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>
): OtoSet => ({
  ...otoSet,
  lines: otoSet.lines.filter((line) => ids.has(line.id)),
});
