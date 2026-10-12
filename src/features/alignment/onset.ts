import { PitchDetector } from "pitchy";

import type { AlignmentResult, CvOnset } from "./types";

const UNVOICED = new Set([
  "k",
  "ky",
  "p",
  "py",
  "t",
  "ty",
  "ch",
  "ts",
  "s",
  "sh",
  "h",
  "hy",
  "f",
  "fy",
]);
const rms = (samples: Float32Array, start: number, length: number) => {
  let energy = 0;
  for (let at = start; at < Math.min(samples.length, start + length); at += 1) {
    const value = samples[at] ?? 0;
    energy += value * value;
  }
  return Math.sqrt(energy / length);
};

const findVoicing = ({
  samples,
  rate,
  from,
  to,
  minimumVolume,
}: {
  samples: Float32Array;
  rate: number;
  from: number;
  to: number;
  minimumVolume: number;
}): number | null => {
  const width = Math.max(4, Math.round(rate * 0.032));
  const step = Math.max(1, Math.round(rate * 0.005));
  const detector = PitchDetector.forFloat32Array(width);
  detector.minVolumeAbsolute = minimumVolume;
  let first: number | undefined;
  let consecutive = 0;
  for (
    let at = from;
    at + width <= samples.length && (at + width / 2) / rate <= to;
    at += step
  ) {
    const [pitch, clarity] = detector.findPitch(
      samples.subarray(at, at + width),
      rate
    );
    if (clarity >= 0.9 && pitch >= 60 && pitch <= 1200) {
      first ??= at;
      consecutive += 1;
      if (consecutive >= 3 && first !== undefined) {
        return Math.round((first + width / 2) / rate / 0.005) * 0.005;
      }
    } else {
      first = undefined;
      consecutive = 0;
    }
  }
  return null;
};

/** 無声子音1つ＋母音のCVだけで、有声開始が明瞭な場合に設定の基準点を補う。 */
export const inferCvOnset = (
  result: AlignmentResult,
  samples: Float32Array,
  rate: number
): CvOnset | null => {
  const [consonant, vowel] = result.intervals;
  if (
    result.intervals.length !== 2 ||
    !consonant ||
    !vowel ||
    !UNVOICED.has(consonant.name) ||
    !["a", "i", "u", "e", "o"].includes(vowel.name) ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    samples.length === 0
  ) {
    return null;
  }
  const width = Math.max(4, Math.round(rate * 0.032));
  const step = Math.max(1, Math.round(rate * 0.005));
  const reference = rms(samples, Math.floor(vowel.start * rate), width);
  if (reference === 0) {
    return null;
  }
  const searchStart = Math.max(0, Math.floor((consonant.start - 0.15) * rate));
  const voicingStart = findVoicing({
    samples,
    rate,
    from: searchStart,
    to: Math.min(vowel.end, vowel.start + 0.03),
    minimumVolume: reference * 0.05,
  });
  if (
    voicingStart === null ||
    voicingStart > vowel.start - 0.01 ||
    vowel.start - voicingStart > 0.25
  ) {
    return null;
  }
  let speechStart = Math.min(consonant.start, voicingStart - 0.005);
  for (let at = searchStart; at < voicingStart * rate; at += step) {
    if (rms(samples, at, step) >= reference * 0.02) {
      speechStart = Math.min(
        speechStart,
        Math.floor(at / rate / 0.005) * 0.005
      );
      break;
    }
  }
  return { speechStart: Math.max(0, speechStart), voicingStart };
};
