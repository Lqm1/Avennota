import { SMALL_KANA } from "../alignment/japanese";
import type { OtoSet } from "../oto/oto-set";
import { aliasCounts, effectiveAlias } from "../oto/oto-set";
import {
  aliasProblem,
  BatchBuilder,
  literalPattern,
  targetLines,
} from "./batch";
import type { BatchResult } from "./batch";

export interface AliasRule {
  source: string;
  target: string;
}

export type AliasRuleMode = "exact" | "keepSuffix" | "keepPrefix" | "keepBoth";

export interface AliasRuleOptions {
  mode: AliasRuleMode;
  allowDuplicates: boolean;
}

/** 「き」の規則が「きゃ」に一致しないよう、後ろに小書きかなが続く箇所は対象にしない。 */
const NOT_SMALL_KANA = `(?![${SMALL_KANA}])`;

const rename = (alias: string, rule: AliasRule, pattern: RegExp): string =>
  alias.replace(pattern, () => rule.target);

export class AliasRules {
  readonly rules: readonly AliasRule[];

  constructor(rules: readonly AliasRule[]) {
    if (rules.length === 0) {
      throw new Error("規則がありません。");
    }
    this.rules = rules;
  }

  static parse(text: string): AliasRules {
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
    return new AliasRules(rules);
  }

  duplicate(
    otoSet: OtoSet,
    ids: ReadonlySet<string>,
    options: AliasRuleOptions
  ): BatchResult {
    const known = aliasCounts(otoSet);
    const lines = targetLines(otoSet, ids);
    const builder = new BatchBuilder(otoSet);
    for (const [rule, pattern] of this.compile(options.mode, false)) {
      for (const line of lines) {
        const alias = effectiveAlias(line.parsed.oto);
        if (!pattern.test(alias)) {
          continue;
        }
        const after = {
          ...line.parsed.oto,
          alias: rename(alias, rule, pattern),
        };
        const problem = aliasProblem(after.alias);
        if (problem !== "") {
          builder.error(line, after, problem);
        } else if (!options.allowDuplicates && known.has(after.alias)) {
          builder.skip(line, after, "同じエイリアスがあります");
        } else {
          known.set(after.alias, (known.get(after.alias) ?? 0) + 1);
          builder.add(line, after, `規則 ${rule.source} → ${rule.target}`);
        }
      }
    }
    return builder.build();
  }

  rename(
    otoSet: OtoSet,
    ids: ReadonlySet<string>,
    options: AliasRuleOptions & { all: boolean }
  ): BatchResult {
    const known = aliasCounts(otoSet);
    const patterns = this.compile(options.mode, options.all);
    const builder = new BatchBuilder(otoSet);
    for (const line of targetLines(otoSet, ids)) {
      const current = effectiveAlias(line.parsed.oto);
      let alias = current;
      for (const [rule, pattern] of patterns) {
        alias = rename(alias, rule, pattern);
      }
      if (alias === current) {
        continue;
      }
      const after = { ...line.parsed.oto, alias };
      const problem = aliasProblem(alias);
      if (problem !== "") {
        builder.error(line, after, problem);
        continue;
      }
      if (!options.allowDuplicates && known.has(alias)) {
        builder.skip(line, after, "同じエイリアスがあります");
        continue;
      }
      const count = known.get(current) ?? 1;
      if (count > 1) {
        known.set(current, count - 1);
      } else {
        known.delete(current);
      }
      known.set(alias, (known.get(alias) ?? 0) + 1);
      builder.change(line, after);
    }
    return builder.build();
  }

  private compile(
    mode: AliasRuleMode,
    global: boolean
  ): (readonly [AliasRule, RegExp])[] {
    return this.rules.map((rule) => {
      const literal = literalPattern(rule.source);
      const body = {
        exact: `^${literal}$`,
        keepBoth: `${literal}${NOT_SMALL_KANA}`,
        keepPrefix: `${literal}$`,
        keepSuffix: `^${literal}${NOT_SMALL_KANA}`,
      }[mode];
      return [rule, new RegExp(body, global ? "gu" : "u")] as const;
    });
  }
}
