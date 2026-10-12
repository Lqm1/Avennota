import type { AlignedRecording } from "./client";
import type { RecordingTranscript } from "./recordings";

export type TempoEstimate =
  | { kind: "estimated"; bpm: number; recordings: number }
  | { kind: "unavailable"; reason: "recordings" | "boundaries" | "agreement" };

const median = (values: number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + upper) / 2
    : upper;
};

export const selectTempoRecordings = (recordings: RecordingTranscript[]) =>
  recordings
    .filter((recording) =>
      recording.morae.some(
        (_, at, morae) =>
          morae
            .slice(at, at + 5)
            .every(
              (mora) =>
                !mora.phones.includes("pau") && !mora.phones.includes("cl")
            ) && at + 5 <= morae.length
      )
    )
    .toSorted((a, b) => b.morae.length - a.morae.length)
    .slice(0, 6);

/** 離れたモーラ間の傾きで境界誤差を抑え、録音ごとの中央値を使う。 */
export const estimateRecordingTempo = (
  recordings: AlignedRecording[]
): TempoEstimate => {
  const beats: number[] = [];
  for (const recording of recordings) {
    let at = 0;
    let segment: { beat: number; time: number; phone: string }[] = [];
    const slopes: number[] = [];
    for (const mora of recording.morae) {
      at += mora.phones.length;
      const vowel = recording.intervals[at - 1];
      if (!vowel || mora.phones.includes("pau") || mora.phones.includes("cl")) {
        segment = [];
        continue;
      }
      const current = {
        beat: segment.length,
        time: vowel.start,
        phone: vowel.name,
      };
      for (const previous of segment) {
        const distance = current.beat - previous.beat;
        if (distance >= 3 && current.phone !== previous.phone) {
          slopes.push((current.time - previous.time) / distance);
        }
      }
      segment.push(current);
    }
    if (slopes.length >= 3) {
      beats.push(median(slopes));
    }
  }
  if (beats.length === 0) {
    return { kind: "unavailable", reason: "boundaries" };
  }
  const beat = median(beats);
  const bpm = Math.round(60 / beat / 5) * 5;
  const agreement = beats.filter(
    (value) => Math.abs(value - beat) / beat < 0.04
  ).length;
  if (bpm <= 0 || !Number.isFinite(bpm) || agreement / beats.length < 0.75) {
    return { kind: "unavailable", reason: "agreement" };
  }
  return { kind: "estimated", bpm, recordings: agreement };
};
