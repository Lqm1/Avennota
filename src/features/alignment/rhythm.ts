import type { AlignedRecording } from "./client";
import { beatLength } from "./oto-generation";

export interface BoundaryCorrection {
  wav: string;
  phone: string;
  before: number;
  after: number;
}

/** 同一母音の境界には音色変化がないため、極端な分割だけ収録拍で補う。 */
export const regularizeRepeatedVowels = (
  recording: AlignedRecording,
  bpm: number
): { recording: AlignedRecording; corrections: BoundaryCorrection[] } => {
  const beat = beatLength(bpm) / 1000;
  const intervals = recording.intervals.map((interval) => ({ ...interval }));
  const corrections: BoundaryCorrection[] = [];
  let at = 0;
  while (at < intervals.length) {
    const first = intervals[at];
    if (!first || !["a", "i", "u", "e", "o", "N"].includes(first.name)) {
      at += 1;
      continue;
    }
    let end = at + 1;
    while (intervals[end]?.name === first.name) {
      end += 1;
    }
    const run = intervals.slice(at, end);
    const last = run.at(-1);
    const extreme = run.some(
      (interval) => interval.end - interval.start < beat * 0.35
    );
    if (
      last &&
      run.length > 1 &&
      extreme &&
      last.end - first.start >= beat * (run.length - 0.75)
    ) {
      for (let index = 1; index < run.length; index += 1) {
        const previous = run[index - 1];
        const current = run[index];
        if (!previous || !current) {
          continue;
        }
        const boundary =
          Math.round((first.start + beat * index) / 0.005) * 0.005;
        corrections.push({
          wav: recording.wav,
          phone: first.name,
          before: current.start,
          after: boundary,
        });
        previous.end = boundary;
        current.start = boundary;
      }
    }
    at = end;
  }
  return { recording: { ...recording, intervals }, corrections };
};
