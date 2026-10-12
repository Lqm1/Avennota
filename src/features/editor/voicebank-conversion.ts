import { continuesSyllable, parseMorae } from "../alignment/japanese";
import type { CvTiming } from "../alignment/oto-generation";
import type {
  SyllableTable,
  SyllableTiming,
} from "../alignment/syllable-table";
import { roundMs } from "../oto/geometry";
import type { OtoParams, OtoSet, ParsedOtoLine } from "../oto/oto-set";
import {
  aliasCounts,
  effectiveAlias,
  PARAM_KEYS,
  withParams,
} from "../oto/oto-set";
import {
  aliasProblem,
  BatchBuilder,
  CONTINUOUS_ALIAS,
  targetLines,
} from "./batch";
import type { BatchResult } from "./batch";
import { keepPreutterAt, layoutProblem } from "./parameter-transforms";

export interface ConversionOptions {
  cv: boolean;
  cvSource: "initial" | "all";
  vc: boolean;
  table: SyllableTable | null;
  useTableConsonant: boolean;
  cvPreutter: number;
  cvOverlap: number;
  consonantLength: number;
  shortenPlosive: boolean;
  allowDuplicates: boolean;
}

const KANA = /^[ぁ-ゖァ-ヺ]+$/u;
const PLOSIVES = new Set(["k", "ky", "t", "p", "py"]);

interface ContinuousAlias {
  lead: string;
  syllable: string;
  suffix: string;
  consonant: string;
  timing: SyllableTiming | null;
}

const kanaConsonant = (syllable: string): string | null => {
  try {
    const morae = parseMorae(syllable);
    const [mora] = morae;
    return morae.length === 1 && mora !== undefined
      ? mora.phones.slice(0, -1).join("")
      : null;
  } catch {
    return null;
  }
};

const splitSyllable = (
  body: string,
  table: SyllableTable | null
): Omit<ContinuousAlias, "lead" | "suffix"> | null => {
  if (table !== null) {
    const timing = table.longestPrefixOf(body);
    if (timing === null) {
      return null;
    }
    const consonant =
      timing.consonant === ""
        ? (kanaConsonant(timing.syllable) ?? "")
        : timing.consonant;
    return { syllable: timing.syllable, consonant, timing };
  }
  for (const length of [2, 1]) {
    const syllable = body.slice(0, length);
    const consonant = KANA.test(syllable) ? kanaConsonant(syllable) : null;
    if (consonant !== null && !continuesSyllable(body, length)) {
      return { syllable, consonant, timing: null };
    }
  }
  return null;
};

const splitLead = (alias: string): { lead: string; body: string } | null => {
  const match = CONTINUOUS_ALIAS.exec(alias);
  const lead = match?.groups?.lead;
  const body = match?.groups?.body;
  return lead === undefined || body === undefined || !KANA.test(body.charAt(0))
    ? null
    : { lead, body };
};

const cvParams = (
  oto: OtoParams,
  timing: CvTiming,
  tableConsonant: number | null
): OtoParams => {
  const moved = keepPreutterAt(oto, timing.preutter);
  return {
    ...moved,
    preutter: timing.preutter,
    overlap: timing.overlap,
    consonant:
      tableConsonant === null
        ? moved.consonant
        : roundMs(timing.preutter + tableConsonant),
  };
};

/** 破裂音の短縮では閉鎖の途中で終え、破裂をCV側に残す。 */
const vcParams = (
  oto: OtoParams,
  length: number,
  plosive: boolean
): OtoParams => {
  const tail = plosive ? length / 2 : length;
  return {
    offset: roundMs(oto.offset - length),
    preutter: oto.preutter,
    overlap: roundMs(oto.preutter / 3),
    consonant: roundMs(oto.preutter + tail / 3),
    cutoff: -roundMs(oto.preutter + tail),
  };
};

const validateOptions = (options: ConversionOptions): void => {
  if (options.table !== null) {
    return;
  }
  if (
    options.cv &&
    !(options.cvPreutter > 0 && options.cvOverlap <= options.cvPreutter)
  ) {
    throw new Error(
      "CVの先行発声は0より大きく、オーバーラップは先行発声以下にしてください。"
    );
  }
  if (options.vc && !(options.consonantLength > 0)) {
    throw new Error("子音の長さは0より大きい値を指定してください。");
  }
};

export const convertVoicebank = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>,
  options: ConversionOptions
): BatchResult => {
  validateOptions(options);
  const known = aliasCounts(otoSet);
  const builder = new BatchBuilder(otoSet);
  const sources = targetLines(otoSet, ids).flatMap((line) => {
    const { oto } = line.parsed;
    const head = splitLead(effectiveAlias(oto));
    if (
      head === null ||
      !(
        (options.cv && (options.cvSource === "all" || head.lead === "-")) ||
        (options.vc && head.lead !== "-")
      )
    ) {
      return [];
    }
    const syllable = splitSyllable(head.body, options.table);
    if (syllable === null) {
      builder.skip(line, null, "音節表にない音節です");
      return [];
    }
    if (PARAM_KEYS.some((key) => !Number.isFinite(oto[key]))) {
      builder.error(line, null, "数値でない欄があります");
      return [];
    }
    const parsed: ContinuousAlias = {
      ...syllable,
      lead: head.lead,
      suffix: head.body.slice(syllable.syllable.length),
    };
    return [{ line, parsed }];
  });
  const add = (
    line: ParsedOtoLine,
    alias: string,
    params: OtoParams,
    note: string
  ) => {
    const { oto } = line.parsed;
    const after = withParams({ ...oto, alias }, params);
    const problem = aliasProblem(alias) || layoutProblem(oto, params);
    if (problem !== "") {
      builder.error(line, after, problem);
    } else if (!options.allowDuplicates && known.has(alias)) {
      builder.skip(line, after, "同じエイリアスがあります");
    } else {
      known.set(alias, (known.get(alias) ?? 0) + 1);
      builder.add(line, after, note);
    }
  };
  if (options.cv) {
    const cvSources = sources
      .filter(({ parsed }) => options.cvSource === "all" || parsed.lead === "-")
      .toSorted(
        (a, b) => Number(b.parsed.lead === "-") - Number(a.parsed.lead === "-")
      );
    for (const { line, parsed } of cvSources) {
      const timing = parsed.timing ?? {
        preutter: options.cvPreutter,
        overlap: options.cvOverlap,
      };
      add(
        line,
        parsed.syllable + parsed.suffix,
        cvParams(
          line.parsed.oto,
          timing,
          options.useTableConsonant && parsed.timing !== null
            ? parsed.timing.consonantFromPreutter
            : null
        ),
        "CV"
      );
    }
  }
  if (options.vc) {
    for (const { line, parsed } of sources) {
      if (parsed.lead === "-" || parsed.consonant === "") {
        continue;
      }
      add(
        line,
        `${parsed.lead} ${parsed.consonant}${parsed.suffix}`,
        vcParams(
          line.parsed.oto,
          parsed.timing?.preutter ?? options.consonantLength,
          options.shortenPlosive && PLOSIVES.has(parsed.consonant)
        ),
        "VC"
      );
    }
  }
  return builder.build();
};
