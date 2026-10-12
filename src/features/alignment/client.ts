import { releaseProxy, transfer, wrap } from "comlink";
import { z } from "zod";

import type { VoiceFolder } from "../../platform/files/types";
import type { AlignmentWorker } from "../../workers/alignment";
import { phoneInventory } from "./models";
import type { VoicebankFormat } from "./oto-generation";
import type { RecordingTranscript } from "./recordings";
import type { AcousticModel, AlignmentResult, CvOnset } from "./types";

export type AlignedRecording = RecordingTranscript &
  AlignmentResult & {
    cvOnset: CvOnset | null;
  };
const trainingProgressSchema = z.object({
  kind: z.literal("training-progress"),
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});

export const inferRecordings = async ({
  folder,
  model,
  recordings,
  format,
  signal,
  onProgress,
  adapt,
  onTrainingProgress,
}: {
  folder: VoiceFolder;
  model: AcousticModel;
  recordings: RecordingTranscript[];
  format: VoicebankFormat;
  signal: AbortSignal;
  onProgress: (completed: number, total: number, wav: string) => void;
  adapt: boolean;
  onTrainingProgress: (completed: number, total: number) => void;
}): Promise<AlignedRecording[]> => {
  signal.throwIfAborted();
  const inventory = phoneInventory(model.phonemap);
  for (const recording of recordings) {
    for (const phone of recording.morae.flatMap((mora) => mora.phones)) {
      if (!inventory.has(phone)) {
        throw new Error(
          `「${recording.wav}」の音素「${phone}」はモデルにありません。`
        );
      }
    }
  }
  const worker = new Worker(
    new URL("../../workers/alignment.ts", import.meta.url),
    { type: "module" }
  );
  const align = wrap<AlignmentWorker>(worker);
  const interruption = Promise.withResolvers<never>();
  const abort = () => {
    worker.terminate();
    interruption.reject(signal.reason);
  };
  const fail = (event: ErrorEvent) => {
    interruption.reject(
      new Error(`自動推定Workerが停止しました: ${event.message}`)
    );
  };
  const decodeFailed = () => {
    interruption.reject(new Error("自動推定Workerの結果を読み取れません。"));
  };
  const trainingProgress = (event: MessageEvent<unknown>) => {
    const parsed = trainingProgressSchema.safeParse(event.data);
    if (parsed.success && !signal.aborted) {
      onTrainingProgress(parsed.data.completed, parsed.data.total);
    }
  };
  signal.addEventListener("abort", abort, { once: true });
  worker.addEventListener("error", fail);
  worker.addEventListener("messageerror", decodeFailed);
  worker.addEventListener("message", trainingProgress);
  try {
    let acousticModel = model;
    if (adapt) {
      await Promise.race([align.prepareTraining(model), interruption.promise]);
      let completed = 0;
      for (const recording of recordings) {
        onProgress(completed, recordings.length, `学習用: ${recording.wav}`);
        // 単一Workerに学習用WAVを順に渡し、元のWAVは保持しない。
        // eslint-disable-next-line no-await-in-loop
        const bytes = await Promise.race([
          folder.read(recording.wav),
          interruption.promise,
        ]);
        signal.throwIfAborted();
        // eslint-disable-next-line no-await-in-loop
        await Promise.race([
          align.addTrainingRecording(
            recording.wav,
            transfer(bytes, [bytes.buffer]),
            recording.morae.flatMap((mora) => mora.phones)
          ),
          interruption.promise,
        ]);
        completed += 1;
      }
      signal.throwIfAborted();
      onTrainingProgress(0, 6);
      acousticModel = await Promise.race([
        align.finishTraining(),
        interruption.promise,
      ]);
      signal.throwIfAborted();
    }
    const results: AlignedRecording[] = [];
    for (const recording of recordings) {
      onProgress(results.length, recordings.length, recording.wav);
      // 単一Workerへ順に送り、音源全体のWAVを同時にメモリへ読み込まない。
      // eslint-disable-next-line no-await-in-loop
      const bytes = await Promise.race([
        folder.read(recording.wav),
        interruption.promise,
      ]);
      signal.throwIfAborted();
      // eslint-disable-next-line no-await-in-loop
      const result = await Promise.race([
        align.align(
          acousticModel,
          transfer(bytes, [bytes.buffer]),
          recording.morae.flatMap((mora) => mora.phones),
          format
        ),
        interruption.promise,
      ]);
      signal.throwIfAborted();
      results.push({ ...recording, ...result });
      onProgress(results.length, recordings.length, recording.wav);
    }
    return results;
  } finally {
    signal.removeEventListener("abort", abort);
    worker.removeEventListener("error", fail);
    worker.removeEventListener("messageerror", decodeFailed);
    worker.removeEventListener("message", trainingProgress);
    align[releaseProxy]();
    worker.terminate();
  }
};
