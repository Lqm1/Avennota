import type { OtoParams, ParamKey } from "./oto-set";
import { PARAM_KEYS, PARAM_LABELS } from "./oto-set";

/** 画面上で動かせるマーカー。キーはF1〜F5の順。 */
export const MARKERS = [
  "offset",
  "overlap",
  "preutter",
  "consonant",
  "cutoff",
] as const;
export type Marker = ParamKey;

export const MARKER_LABELS: Record<Marker, string> = PARAM_LABELS;

export const MARKER_KEYS: Record<Marker, string> = {
  consonant: "F4",
  cutoff: "F5",
  offset: "F1",
  overlap: "F2",
  preutter: "F3",
};

/** 原音の先頭からの絶対位置（ミリ秒）。 */
export type MarkerPositions = Record<Marker, number>;

/**
 * 右ブランクの終端位置。負の値は左ブランクからの長さ、0以上は原音の末尾からの距離。
 */
export const cutoffEnd = (params: OtoParams, durationMs: number): number =>
  params.cutoff < 0
    ? params.offset - params.cutoff
    : durationMs - params.cutoff;

export const toPositions = (
  params: OtoParams,
  durationMs: number
): MarkerPositions => ({
  consonant: params.offset + params.consonant,
  cutoff: cutoffEnd(params, durationMs),
  offset: params.offset,
  overlap: params.offset + params.overlap,
  preutter: params.offset + params.preutter,
});

export const roundMs = (value: number): number =>
  Math.round(value * 1000) / 1000;

/** 正の右ブランクは末尾からの距離なので変えない。 */
export const moveOffset = (params: OtoParams, offset: number): OtoParams => {
  const delta = offset - params.offset;
  return {
    offset: roundMs(offset),
    consonant: roundMs(params.consonant - delta),
    preutter: roundMs(params.preutter - delta),
    overlap: roundMs(params.overlap - delta),
    cutoff: params.cutoff < 0 ? roundMs(params.cutoff + delta) : params.cutoff,
  };
};

/** 負の右ブランクは0になると意味が変わるため、左ブランクより後ろにこの長さだけ残す。 */
const MIN_NEGATIVE_CUTOFF = 1;

/** 右ブランクの表現を正負で切り替える。終端の位置は変えない。 */
export const toggleCutoffSign = (
  params: OtoParams,
  durationMs: number
): Partial<OtoParams> => {
  const end = cutoffEnd(params, durationMs);
  if (params.cutoff < 0) {
    return { cutoff: roundMs(Math.max(durationMs - end, 0)) };
  }
  return {
    cutoff: roundMs(-Math.max(end - params.offset, MIN_NEGATIVE_CUTOFF)),
  };
};

/**
 * 編集時に知らせる範囲の問題。既存データは補正せず、利用者が判断できるよう表示に使う。
 */
export const paramWarnings = (params: OtoParams): string[] => {
  const warnings: string[] = [];
  if (PARAM_KEYS.some((key) => Number.isNaN(params[key]))) {
    return warnings;
  }
  if (params.offset < 0) {
    warnings.push("左ブランクが負です");
  }
  if (params.consonant < 0) {
    warnings.push("固定範囲が負です");
  }
  if (params.preutter < 0) {
    warnings.push("先行発声が左ブランクより前です");
  }
  return warnings;
};

export const rangeWarnings = (
  params: OtoParams,
  durationMs: number
): string[] => {
  const warnings = paramWarnings(params);
  if (PARAM_KEYS.some((key) => Number.isNaN(params[key]))) {
    return warnings;
  }
  const end = cutoffEnd(params, durationMs);
  if (params.offset > durationMs) {
    warnings.push("左ブランクが原音の長さを超えています");
  }
  if (end <= params.offset) {
    warnings.push("右ブランクが左ブランクより前です");
  }
  if (end > durationMs + 0.001) {
    warnings.push("右ブランクが原音の長さを超えています");
  }
  if (params.offset + params.consonant > end) {
    warnings.push("固定範囲が右ブランクを超えています");
  }
  return warnings;
};
