import { continuousTiming } from "../alignment/oto-generation";
import { moveOffset, roundMs } from "../oto/geometry";
import type { Oto, OtoParams, OtoSet } from "../oto/oto-set";
import {
  effectiveAlias,
  PARAM_KEYS,
  setLineOto,
  withParams,
} from "../oto/oto-set";
import { CONTINUOUS_ALIAS, targetLines } from "./batch";
import type { BatchEntry, BatchResult } from "./batch";

export type ParameterOperation =
  | { kind: "overlapThird" }
  | { kind: "preutter"; value: number }
  | { kind: "ratio" }
  | { kind: "bpm"; bpm: number };

export interface ParameterOptions {
  digits: number;
  continuousOnly: boolean;
}

/** ちょうど半分の負の値も0から遠ざける。 */
export const roundTo = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return (Math.sign(value) * Math.round(Math.abs(value) * scale)) / scale;
};

export const keepPreutterAt = (oto: OtoParams, preutter: number): OtoParams =>
  moveOffset(oto, oto.offset + oto.preutter - preutter);

const planOperation = (
  operation: ParameterOperation,
  digits: number
): ((oto: OtoParams) => OtoParams) => {
  const round = (value: number) => roundTo(value, digits);
  switch (operation.kind) {
    case "overlapThird": {
      return (oto) => ({ ...oto, overlap: round(oto.preutter / 3) });
    }
    case "preutter": {
      if (!(Number.isFinite(operation.value) && operation.value > 0)) {
        throw new Error("先行発声は0より大きい値を指定してください。");
      }
      const preutter = round(operation.value);
      const overlap = round(operation.value / 3);
      return (oto) => ({ ...keepPreutterAt(oto, preutter), preutter, overlap });
    }
    case "ratio": {
      return (oto) => {
        const distance = oto.preutter - oto.overlap;
        const preutter = round((distance * 3) / 2);
        return {
          ...keepPreutterAt(oto, preutter),
          preutter,
          overlap: round(distance / 2),
        };
      };
    }
    case "bpm": {
      const timing = continuousTiming(operation.bpm, round);
      return (oto) => ({
        ...timing,
        offset: roundMs(oto.offset + oto.preutter - timing.preutter),
      });
    }
    default: {
      return operation satisfies never;
    }
  }
};

export const layoutProblem = (oto: OtoParams, next: OtoParams): string => {
  if (next.offset < 0) {
    return "左ブランクが負になります";
  }
  if (next.consonant < 0) {
    return "固定範囲が左ブランクより前になります";
  }
  if (oto.cutoff < 0 && next.cutoff >= 0) {
    return "右ブランクが左ブランクより前になります";
  }
  return "";
};

const isContinuous = (oto: Oto): boolean => {
  const lead = CONTINUOUS_ALIAS.exec(effectiveAlias(oto))?.groups?.lead;
  return lead !== undefined && lead !== "-";
};

export const transformParameters = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>,
  operation: ParameterOperation,
  options: ParameterOptions
): BatchResult => {
  const transform = planOperation(operation, options.digits);
  const entries: BatchEntry[] = [];
  const changes = new Map<string, Oto>();
  for (const line of targetLines(otoSet, ids)) {
    const { oto } = line.parsed;
    if (options.continuousOnly && !isContinuous(oto)) {
      continue;
    }
    if (PARAM_KEYS.some((key) => !Number.isFinite(oto[key]))) {
      entries.push({
        kind: "error",
        lineId: line.id,
        before: oto,
        after: null,
        note: "数値でない欄があります",
      });
      continue;
    }
    const params = transform(oto);
    const after = withParams(oto, params);
    if (after === oto) {
      continue;
    }
    const problem =
      operation.kind === "ratio" && oto.preutter <= oto.overlap
        ? "先行発声がオーバーラップより後ろにありません"
        : layoutProblem(oto, params);
    entries.push({
      kind: problem === "" ? "change" : "error",
      lineId: line.id,
      before: oto,
      after,
      note: problem,
    });
    if (problem === "") {
      changes.set(line.id, after);
    }
  }
  return {
    base: otoSet,
    otoSet:
      changes.size === 0
        ? otoSet
        : {
            ...otoSet,
            lines: otoSet.lines.map((line) => {
              const oto = changes.get(line.id);
              return oto === undefined ? line : setLineOto(line, oto);
            }),
          },
    entries,
  };
};
