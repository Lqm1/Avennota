import { parseMorae } from "../alignment/japanese";
import type { CvTiming, SyllableTiming } from "../alignment/oto-generation";
import type { Oto, OtoLine, OtoParams, OtoSet } from "../oto/oto-set";
import { PARAM_KEYS, withParams } from "../oto/oto-set";
import {
  aliasCounts,
  aliasProblem,
  appendLines,
  copyLine,
  effectiveAlias,
  SMALL_KANA,
  targetLines,
} from "./batch";
import type { BatchEntry, BatchResult } from "./batch";
import { layoutProblem, moveOffset, roundTo } from "./parameter-transforms";

export interface ConversionOptions {
  cv: boolean;
  cvSource: "initial" | "all";
  vc: boolean;
  table: readonly SyllableTiming[] | null;
  useTableConsonant: boolean;
  cvPreutter: number;
  cvOverlap: number;
  consonantLength: number;
  shortenPlosive: boolean;
  allowDuplicates: boolean;
}

const CONTINUOUS = /^(?<lead>[aiueonN-]) (?<body>.+)$/u;
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

const followedBySmallKana = (body: string, length: number): boolean => {
  const next = body.charAt(length);
  return next !== "" && SMALL_KANA.includes(next);
};

const splitSyllable = (
  body: string,
  table: readonly SyllableTiming[] | null
): Omit<ContinuousAlias, "lead" | "suffix"> | null => {
  if (table !== null) {
    let timing: SyllableTiming | null = null;
    for (const entry of table) {
      if (
        body.startsWith(entry.syllable) &&
        !followedBySmallKana(body, entry.syllable.length) &&
        entry.syllable.length > (timing?.syllable.length ?? 0)
      ) {
        timing = entry;
      }
    }
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
    if (consonant !== null && !followedBySmallKana(body, length)) {
      return { syllable, consonant, timing: null };
    }
  }
  return null;
};

const splitLead = (alias: string): { lead: string; body: string } | null => {
  const match = CONTINUOUS.exec(alias);
  const lead = match?.groups?.lead;
  const body = match?.groups?.body;
  return lead === undefined || body === undefined || !KANA.test(body.charAt(0))
    ? null
    : { lead, body };
};

const ms = (value: number) => roundTo(value, 3);

const cvParams = (
  oto: OtoParams,
  timing: CvTiming,
  tableConsonant: number | null
): OtoParams => {
  const offset = oto.offset + oto.preutter - timing.preutter;
  const moved = moveOffset(oto, offset);
  return {
    ...moved,
    preutter: timing.preutter,
    overlap: timing.overlap,
    consonant:
      tableConsonant === null
        ? moved.consonant
        : ms(timing.preutter + tableConsonant),
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
    offset: ms(oto.offset - length),
    preutter: oto.preutter,
    overlap: ms(oto.preutter / 3),
    consonant: ms(oto.preutter + tail / 3),
    cutoff: -ms(oto.preutter + tail),
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
  const entries: BatchEntry[] = [];
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
      entries.push({
        kind: "skip",
        lineId: line.id,
        before: oto,
        after: null,
        note: "音節表にない音節です",
      });
      return [];
    }
    if (PARAM_KEYS.some((key) => !Number.isFinite(oto[key]))) {
      entries.push({
        kind: "error",
        lineId: line.id,
        before: oto,
        after: null,
        note: "数値でない欄があります",
      });
      return [];
    }
    const parsed: ContinuousAlias = {
      ...syllable,
      lead: head.lead,
      suffix: head.body.slice(syllable.syllable.length),
    };
    return [{ line, oto, parsed }];
  });
  const generated: OtoLine[] = [];
  const add = (
    source: (typeof sources)[number],
    alias: string,
    params: OtoParams,
    note: string
  ) => {
    const after: Oto = withParams({ ...source.oto, alias }, params);
    let problem = aliasProblem(alias) || layoutProblem(source.oto, params);
    let kind: BatchEntry["kind"] = problem === "" ? "add" : "error";
    if (kind === "add" && !options.allowDuplicates && known.has(alias)) {
      kind = "skip";
      problem = "同じエイリアスがあります";
    }
    entries.push({
      kind,
      lineId: source.line.id,
      before: source.oto,
      after,
      note: problem || note,
    });
    if (kind === "add") {
      known.set(alias, (known.get(alias) ?? 0) + 1);
      generated.push(copyLine(source.line, after));
    }
  };
  if (options.cv) {
    const cvSources = sources
      .filter(({ parsed }) => options.cvSource === "all" || parsed.lead === "-")
      .toSorted(
        (a, b) => Number(b.parsed.lead === "-") - Number(a.parsed.lead === "-")
      );
    for (const source of cvSources) {
      const { parsed } = source;
      const timing = parsed.timing ?? {
        preutter: options.cvPreutter,
        overlap: options.cvOverlap,
      };
      add(
        source,
        parsed.syllable + parsed.suffix,
        cvParams(
          source.oto,
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
    for (const source of sources) {
      const { parsed } = source;
      if (parsed.lead === "-" || parsed.consonant === "") {
        continue;
      }
      add(
        source,
        `${parsed.lead} ${parsed.consonant}${parsed.suffix}`,
        vcParams(
          source.oto,
          parsed.timing?.preutter ?? options.consonantLength,
          options.shortenPlosive && PLOSIVES.has(parsed.consonant)
        ),
        "VC"
      );
    }
  }
  return { base: otoSet, otoSet: appendLines(otoSet, generated), entries };
};
