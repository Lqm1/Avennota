import type { EditorSettings } from "../editor/settings";
import { cutoffEnd, roundMs, toPositions } from "./geometry";
import type { Marker } from "./geometry";
import type { OtoParams } from "./oto-set";

const relativeMovement = (
  marker: Marker,
  settings: Pick<EditorSettings, "offsetMode" | "preutterMode">
): boolean =>
  (marker === "offset" && settings.offsetMode === "relative") ||
  (marker === "preutter" && settings.preutterMode === "relative");
/** 手動編集の移動制約。読み込み値や数値欄の値には適用しない。 */
export const moveMarkerWithConstraints = (
  params: OtoParams,
  marker: Marker,
  ms: number,
  duration: number,
  settings: Pick<
    EditorSettings,
    | "offsetMode"
    | "preutterMode"
    | "negativeOverlap"
    | "blankBroom"
    | "cutoffMode"
  >
): OtoParams => {
  const p = toPositions(params, duration);
  const position = Math.min(ms, duration);
  if (relativeMovement(marker, settings)) {
    const delta = Math.min(
      Math.max(position - p[marker], -params.offset),
      duration - p.cutoff
    );
    return {
      ...params,
      offset: roundMs(params.offset + delta),
      cutoff:
        params.cutoff < 0 ? params.cutoff : roundMs(params.cutoff - delta),
    };
  }
  p[marker] = marker === "overlap" ? position : Math.max(0, position);
  if (marker === "offset") {
    for (const key of ["consonant", "cutoff", "preutter", "overlap"] as const) {
      if (key === "overlap" && settings.negativeOverlap) {
        continue;
      }
      if (p.offset > p[key]) {
        if (settings.blankBroom) {
          p[key] = p.offset;
        } else {
          p.offset = p[key];
        }
      }
    }
  } else if (marker === "cutoff") {
    for (const key of ["offset", "consonant", "preutter", "overlap"] as const) {
      if (p.cutoff < p[key]) {
        if (settings.blankBroom) {
          p[key] = p.cutoff;
        } else {
          p.cutoff = p[key];
        }
      }
    }
  } else if (marker === "preutter") {
    p.preutter = Math.min(
      Math.max(p.preutter, p.offset, 0),
      p.consonant,
      p.cutoff
    );
  } else if (marker === "consonant") {
    p.consonant = Math.min(
      Math.max(p.consonant, p.offset, p.preutter, p.overlap, 0),
      p.cutoff
    );
  } else {
    p.overlap = Math.min(
      settings.negativeOverlap ? p.overlap : Math.max(p.overlap, p.offset),
      p.consonant,
      p.cutoff
    );
  }
  return {
    offset: roundMs(p.offset),
    overlap: roundMs(p.overlap - p.offset),
    preutter: roundMs(p.preutter - p.offset),
    consonant: roundMs(p.consonant - p.offset),
    cutoff:
      settings.cutoffMode === "negative"
        ? roundMs(p.offset - p.cutoff)
        : roundMs(duration - p.cutoff),
  };
};

export const shiftRelativeMarkers = (
  params: OtoParams,
  delta: number
): OtoParams => ({
  ...params,
  offset: roundMs(params.offset + delta),
  cutoff:
    params.cutoff < 0
      ? params.cutoff
      : roundMs(Math.max(0, params.cutoff - delta)),
});
export const cutoffInMode = (
  params: OtoParams,
  duration: number,
  mode: EditorSettings["cutoffMode"]
): number =>
  mode === "negative"
    ? params.offset - cutoffEnd(params, duration)
    : duration - cutoffEnd(params, duration);
