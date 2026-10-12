import type { DocumentBytes } from "../../platform/files/documents";
import {
  applyFileChanges,
  readIfExists,
} from "../../platform/files/transaction";
import type { VoiceFolder } from "../../platform/files/types";
import { fileStem } from "../oto/oto-set";
import type { AlignmentResult, PhoneInterval } from "./types";

export type LabelRecording = AlignmentResult & { wav: string };

/** 原音設定用の補正を加えず、前後の無音を含む原音全体を出力する。 */
const intervalsWithSilence = (recording: LabelRecording): PhoneInterval[] => {
  const intervals: PhoneInterval[] = [];
  let end = 0;
  for (const interval of recording.intervals) {
    const { start, end: intervalEnd } = interval;
    if (start > end) {
      intervals.push({ name: "pau", start: end, end: start });
    }
    if (intervalEnd > start) {
      intervals.push(interval);
    }
    end = intervalEnd;
  }
  if (recording.duration > end) {
    intervals.push({ name: "pau", start: end, end: recording.duration });
  }
  return intervals;
};

export const createLabelExports = (
  recordings: LabelRecording[]
): DocumentBytes[] => {
  const encoder = new TextEncoder();
  return recordings.map((recording) => ({
    name: `${fileStem(recording.wav)}.lab`,
    bytes: encoder.encode(
      intervalsWithSilence(recording)
        .map(
          ({ start, end, name }) =>
            `${Math.round(start * 10_000_000)} ${Math.round(end * 10_000_000)} ${name}\n`
        )
        .join("")
    ),
  }));
};

export const saveLabels = async (
  folder: VoiceFolder,
  recordings: LabelRecording[]
): Promise<void> => {
  if (!(await folder.ensureWritable())) {
    throw new Error("音源フォルダへの書き込みが許可されていません。");
  }
  const changes = await Promise.all(
    createLabelExports(recordings).map(async ({ name, bytes }) => ({
      name,
      before: await readIfExists(folder, name),
      after: bytes,
    }))
  );
  await applyFileChanges(folder, changes);
};
