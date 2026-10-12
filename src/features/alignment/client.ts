/* eslint-disable no-await-in-loop -- WAVを順に転送してメモリ使用量を抑え、単一Workerで処理する。 */
import { releaseProxy, transfer, wrap } from "comlink";
import type { Remote } from "comlink";
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

const phonesOf = (recording: RecordingTranscript): string[] =>
  recording.morae.flatMap((mora) => mora.phones);

class AlignmentWorkerSession {
  readonly align: Remote<AlignmentWorker>;
  private readonly worker: Worker;
  private readonly signal: AbortSignal;
  private readonly onTrainingProgress: (
    completed: number,
    total: number
  ) => void;
  private readonly ready = Promise.withResolvers<null>();
  private readonly interruption = Promise.withResolvers<never>();

  constructor(
    signal: AbortSignal,
    onTrainingProgress: (completed: number, total: number) => void
  ) {
    this.signal = signal;
    this.onTrainingProgress = onTrainingProgress;
    this.worker = new Worker(
      new URL("../../workers/alignment.ts", import.meta.url),
      { type: "module" }
    );
    this.align = wrap<AlignmentWorker>(this.worker);
    signal.addEventListener("abort", this.abort, { once: true });
    this.worker.addEventListener("error", this.fail);
    this.worker.addEventListener("messageerror", this.decodeFailed);
    this.worker.addEventListener("message", this.receive);
  }

  async started(): Promise<void> {
    await this.call(this.ready.promise);
  }

  async call<T>(promise: Promise<T>): Promise<T> {
    return await Promise.race([promise, this.interruption.promise]);
  }

  dispose(): void {
    this.signal.removeEventListener("abort", this.abort);
    this.worker.removeEventListener("error", this.fail);
    this.worker.removeEventListener("messageerror", this.decodeFailed);
    this.worker.removeEventListener("message", this.receive);
    this.align[releaseProxy]();
    this.worker.terminate();
  }

  private readonly abort = () => {
    this.worker.terminate();
    this.interruption.reject(this.signal.reason);
  };

  private readonly fail = (event: ErrorEvent) => {
    this.interruption.reject(
      new Error(`自動推定ワーカーが停止しました: ${event.message}`)
    );
  };

  private readonly decodeFailed = () => {
    this.interruption.reject(
      new Error("自動推定ワーカーの処理結果を受信できませんでした。")
    );
  };

  private readonly receive = (event: MessageEvent<unknown>) => {
    if (event.data === "ready") {
      this.ready.resolve(null);
      return;
    }
    const parsed = trainingProgressSchema.safeParse(event.data);
    if (parsed.success && !this.signal.aborted) {
      this.onTrainingProgress(parsed.data.completed, parsed.data.total);
    }
  };
}

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
    for (const phone of phonesOf(recording)) {
      if (!inventory.has(phone)) {
        throw new Error(
          `「${recording.wav}」の音素「${phone}」は音響モデルに対応していません。`
        );
      }
    }
  }
  const session = new AlignmentWorkerSession(signal, onTrainingProgress);
  try {
    await session.started();
    let acousticModel = model;
    if (adapt) {
      await session.call(session.align.prepareTraining(model));
      let completed = 0;
      for (const recording of recordings) {
        onProgress(completed, recordings.length, `学習用: ${recording.wav}`);
        const bytes = await session.call(folder.read(recording.wav));
        signal.throwIfAborted();
        await session.call(
          session.align.addTrainingRecording(
            recording.wav,
            transfer(bytes, [bytes.buffer]),
            phonesOf(recording)
          )
        );
        completed += 1;
      }
      signal.throwIfAborted();
      onTrainingProgress(0, 6);
      acousticModel = await session.call(session.align.finishTraining());
      signal.throwIfAborted();
    }
    const results: AlignedRecording[] = [];
    for (const recording of recordings) {
      onProgress(results.length, recordings.length, recording.wav);
      const bytes = await session.call(folder.read(recording.wav));
      signal.throwIfAborted();
      const result = await session.call(
        session.align.align(
          acousticModel,
          transfer(bytes, [bytes.buffer]),
          phonesOf(recording),
          format
        )
      );
      signal.throwIfAborted();
      results.push({ ...recording, ...result });
      onProgress(results.length, recordings.length, recording.wav);
    }
    return results;
  } finally {
    session.dispose();
  }
};
