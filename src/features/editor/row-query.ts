import { SMALL_KANA } from "../alignment/japanese";
import type { OtoLine, OtoSet } from "../oto/oto-set";
import { effectiveAlias, isOtoLine } from "../oto/oto-set";
import { aliasProblem, BatchBuilder, literalPattern } from "./batch";
import type { BatchResult } from "./batch";

export type QueryField = "alias" | "wav" | "comment" | "text";
export type QueryMode = "contains" | "exact" | "regex";

export interface RowQueryOptions {
  field: QueryField;
  mode: QueryMode;
  text: string;
  ignoreCase: boolean;
  excludeYoon: boolean;
}

const patternSource = (options: RowQueryOptions): string => {
  if (options.mode === "regex") {
    return options.text;
  }
  const literal = literalPattern(options.text);
  if (options.mode === "exact") {
    return `^${literal}$`;
  }
  return options.excludeYoon ? `${literal}(?![${SMALL_KANA}])` : literal;
};

export class RowQuery {
  private readonly field: QueryField;
  private readonly regex: boolean;
  private readonly pattern: RegExp;

  constructor(options: RowQueryOptions) {
    if (options.text === "") {
      throw new Error("検索する文字列を入力してください。");
    }
    this.field = options.field;
    this.regex = options.mode === "regex";
    this.pattern = new RegExp(
      patternSource(options),
      options.ignoreCase ? "iu" : "u"
    );
  }

  matchingIds(otoSet: OtoSet, ids: ReadonlySet<string>): string[] {
    return otoSet.lines.flatMap((line) => {
      const value = ids.has(line.id) ? this.valueOf(line) : null;
      return value !== null && this.pattern.test(value) ? [line.id] : [];
    });
  }

  replace(
    otoSet: OtoSet,
    ids: ReadonlySet<string>,
    replacement: string,
    all: boolean
  ): BatchResult {
    if (this.field !== "alias" && this.field !== "comment") {
      throw new Error("置換できるのはエイリアスとコメントです。");
    }
    const pattern =
      all || !this.regex
        ? new RegExp(this.pattern.source, `${this.pattern.flags}g`)
        : this.pattern;
    const builder = new BatchBuilder(otoSet);
    for (const line of otoSet.lines) {
      const value = ids.has(line.id) ? this.valueOf(line) : null;
      if (value === null || !isOtoLine(line)) {
        continue;
      }
      const next = this.regex
        ? value.replace(pattern, replacement)
        : value.replace(pattern, () => replacement);
      if (next === value) {
        continue;
      }
      if (this.field === "comment") {
        if (/[\r\n]/u.test(next)) {
          builder.error(line, null, "コメントに改行が入ります");
        } else {
          builder.changeComment(line, next, `コメント: ${value} → ${next}`);
        }
        continue;
      }
      const after = { ...line.parsed.oto, alias: next };
      const problem = aliasProblem(next);
      if (problem === "") {
        builder.change(line, after);
      } else {
        builder.error(line, after, problem);
      }
    }
    return builder.build();
  }

  private valueOf(line: OtoLine): string | null {
    if (line.parsed.kind === "blank") {
      return null;
    }
    if (this.field === "text") {
      return line.text;
    }
    if (!isOtoLine(line)) {
      return null;
    }
    if (this.field === "comment") {
      return line.comment ?? "";
    }
    return this.field === "wav"
      ? line.parsed.oto.wav
      : effectiveAlias(line.parsed.oto);
  }
}

export const extractLines = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>
): OtoSet => ({
  ...otoSet,
  lines: otoSet.lines.filter((line) => ids.has(line.id)),
});
