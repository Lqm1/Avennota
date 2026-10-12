import type { Oto, OtoParams, OtoSet } from "../oto/oto-set";
import { PARAM_KEYS, setLineOto, withParams } from "../oto/oto-set";
import { effectiveAlias, targetLines } from "./batch";
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

const CONTINUOUS = /^[aiueonN] /u;

/** ちょうど半分の負の値も0から遠ざける。 */
export const roundTo = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return (Math.sign(value) * Math.round(Math.abs(value) * scale)) / scale;
};

/** 位置の差から作る値は保存時の小数3桁に揃え、浮動小数点の誤差を残さない。 */
const ms = (value: number): number => roundTo(value, 3);

/** 正の右ブランクは末尾からの距離なので変えない。 */
export const moveOffset = (
  oto: OtoParams,
  offset: number
): Pick<OtoParams, "offset" | "consonant" | "cutoff"> => ({
  offset: ms(offset),
  consonant: ms(oto.offset + oto.consonant - offset),
  cutoff: oto.cutoff < 0 ? ms(offset - (oto.offset - oto.cutoff)) : oto.cutoff,
});

const nextParams = (
  oto: OtoParams,
  operation: ParameterOperation,
  digits: number
): OtoParams => {
  const round = (value: number) => roundTo(value, digits);
  const preutterAt = oto.offset + oto.preutter;
  switch (operation.kind) {
    case "overlapThird": {
      return { ...oto, overlap: round(oto.preutter / 3) };
    }
    case "preutter": {
      const preutter = round(operation.value);
      return {
        ...moveOffset(oto, preutterAt - preutter),
        preutter,
        overlap: round(operation.value / 3),
      };
    }
    case "ratio": {
      const distance = oto.preutter - oto.overlap;
      const preutter = round((distance * 3) / 2);
      return {
        ...moveOffset(oto, preutterAt - preutter),
        preutter,
        overlap: round(distance / 2),
      };
    }
    case "bpm": {
      const beat = 60_000 / operation.bpm;
      const preutter = round(beat / 2);
      const overlap = round(beat / 6);
      return {
        offset: ms(preutterAt - preutter),
        preutter,
        overlap,
        consonant: round((beat * 3) / 4),
        cutoff: -round(beat + overlap),
      };
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

export const validateOperation = (operation: ParameterOperation): string => {
  if (
    operation.kind === "preutter" &&
    !(Number.isFinite(operation.value) && operation.value > 0)
  ) {
    return "先行発声は0より大きい値を指定してください。";
  }
  if (
    operation.kind === "bpm" &&
    !(Number.isFinite(operation.bpm) && operation.bpm > 0)
  ) {
    return "BPMは0より大きい値を指定してください。";
  }
  return "";
};

export const transformParameters = (
  otoSet: OtoSet,
  ids: ReadonlySet<string>,
  operation: ParameterOperation,
  options: ParameterOptions
): BatchResult => {
  const invalid = validateOperation(operation);
  if (invalid !== "") {
    throw new Error(invalid);
  }
  const entries: BatchEntry[] = [];
  const changes = new Map<string, Oto>();
  for (const line of targetLines(otoSet, ids)) {
    const { oto } = line.parsed;
    if (options.continuousOnly && !CONTINUOUS.test(effectiveAlias(oto))) {
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
    const params = nextParams(oto, operation, options.digits);
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
