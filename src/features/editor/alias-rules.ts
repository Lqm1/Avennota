import type { OtoLine, OtoSet } from "../oto/oto-set";
import { setLineOto } from "../oto/oto-set";
import {
  aliasCounts,
  aliasProblem,
  appendLines,
  copyLine,
  effectiveAlias,
  literalPattern,
  SMALL_KANA,
  targetLines,
} from "./batch";
import type { BatchEntry, BatchResult } from "./batch";

export interface AliasRule {
  source: string;
  target: string;
}

export type AliasRuleMode = "exact" | "keepSuffix" | "keepPrefix" | "keepBoth";

export interface AliasRuleOptions {
  mode: AliasRuleMode;
  allowDuplicates: boolean;
}

export const parseAliasRules = (text: string): AliasRule[] => {
  const rules: AliasRule[] = [];
  for (const [index, row] of text.split(/\r\n|\r|\n/u).entries()) {
    if (row.trim() === "") {
      continue;
    }
    const fields = row.split(",");
    const [source = "", target = ""] = fields;
    if (fields.length !== 2 || source === "") {
      throw new Error(
        `規則の${index + 1}行目を読めません。「変換元,変換先」の2列で書いてください。`
      );
    }
    rules.push({ source, target });
  }
  if (rules.length === 0) {
    throw new Error("規則がありません。");
  }
  return rules;
};

/** 「き」の規則が「きゃ」に一致しないよう、後ろに小書きかなが続く箇所は対象にしない。 */
const NOT_SMALL_KANA = `(?![${SMALL_KANA}])`;

const rulePattern = (
  source: string,
  mode: AliasRuleMode,
  global = false
): RegExp => {
  const literal = literalPattern(source);
  const body = {
    exact: `^${literal}$`,
    keepBoth: `${literal}${NOT_SMALL_KANA}`,
    keepPrefix: `${literal}$`,
    keepSuffix: `^${literal}${NOT_SMALL_KANA}`,
  }[mode];
  return new RegExp(body, global ? "gu" : "u");
};

const rename = (alias: string, rule: AliasRule, pattern: RegExp): string =>
  alias.replace(pattern, () => rule.target);

export const duplicateByRules = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>,
  rules: readonly AliasRule[],
  options: AliasRuleOptions
): BatchResult => {
  const known = aliasCounts(otoSet);
  const lines = targetLines(otoSet, ids);
  const entries: BatchEntry[] = [];
  const added: OtoLine[] = [];
  for (const rule of rules) {
    const pattern = rulePattern(rule.source, options.mode);
    for (const line of lines) {
      const { oto } = line.parsed;
      const alias = effectiveAlias(oto);
      if (!pattern.test(alias)) {
        continue;
      }
      const after = { ...oto, alias: rename(alias, rule, pattern) };
      const problem = aliasProblem(after.alias);
      if (problem !== "") {
        entries.push({
          kind: "error",
          lineId: line.id,
          before: oto,
          after,
          note: problem,
        });
        continue;
      }
      if (!options.allowDuplicates && known.has(after.alias)) {
        entries.push({
          kind: "skip",
          lineId: line.id,
          before: oto,
          after,
          note: "同じエイリアスがあります",
        });
        continue;
      }
      known.set(after.alias, (known.get(after.alias) ?? 0) + 1);
      added.push(copyLine(line, after));
      entries.push({
        kind: "add",
        lineId: line.id,
        before: oto,
        after,
        note: `規則 ${rule.source} → ${rule.target}`,
      });
    }
  }
  return { base: otoSet, otoSet: appendLines(otoSet, added), entries };
};

export const renameByRules = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>,
  rules: readonly AliasRule[],
  options: AliasRuleOptions & { all: boolean }
): BatchResult => {
  const known = aliasCounts(otoSet);
  const patterns = rules.map(
    (rule) =>
      [rule, rulePattern(rule.source, options.mode, options.all)] as const
  );
  const entries: BatchEntry[] = [];
  const changes = new Map<string, OtoLine>();
  for (const line of targetLines(otoSet, ids)) {
    const { oto } = line.parsed;
    const current = effectiveAlias(oto);
    let alias = current;
    for (const [rule, pattern] of patterns) {
      alias = rename(alias, rule, pattern);
    }
    if (alias === current) {
      continue;
    }
    const after = { ...oto, alias };
    const problem = aliasProblem(alias);
    let note = problem;
    if (note === "" && !options.allowDuplicates && known.has(alias)) {
      note = "同じエイリアスがあります";
    }
    if (note !== "") {
      entries.push({
        kind: problem === "" ? "skip" : "error",
        lineId: line.id,
        before: oto,
        after,
        note,
      });
      continue;
    }
    const count = known.get(current) ?? 1;
    if (count > 1) {
      known.set(current, count - 1);
    } else {
      known.delete(current);
    }
    known.set(alias, (known.get(alias) ?? 0) + 1);
    changes.set(line.id, setLineOto(line, after));
    entries.push({ kind: "change", lineId: line.id, before: oto, after, note });
  }
  return {
    base: otoSet,
    otoSet:
      changes.size === 0
        ? otoSet
        : {
            ...otoSet,
            lines: otoSet.lines.map((line) => changes.get(line.id) ?? line),
          },
    entries,
  };
};
