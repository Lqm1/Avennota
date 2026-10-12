import wasmUrl from "@shiro-rs/wasm/shared/index_bg.wasm?url";
import init, { Wave } from "@shiro-rs/wasm/web";
import { expose } from "comlink";

import { alignRecording } from "../features/alignment/inference";
import { inferCvOnset } from "../features/alignment/onset";
import type { VoicebankFormat } from "../features/alignment/oto-generation";
import { AcousticModelTrainer } from "../features/alignment/training";
import type { AcousticModel } from "../features/alignment/types";

let initialization: ReturnType<typeof init> | undefined;
const align = async (
  model: AcousticModel,
  bytes: Uint8Array,
  phones: string[],
  format: VoicebankFormat
) => {
  initialization ??= init({ module_or_path: wasmUrl });
  await initialization;
  const result = alignRecording(model, bytes, phones);
  if (format !== "cv") {
    return { ...result, cvOnset: null };
  }
  const wave = Wave.read(bytes, 30_000_000);
  try {
    return {
      ...result,
      cvOnset: inferCvOnset(result, wave.samples(), wave.sample_rate),
    };
  } finally {
    wave.free();
  }
};

let trainer: AcousticModelTrainer | undefined;
const prepareTraining = async (model: AcousticModel) => {
  initialization ??= init({ module_or_path: wasmUrl });
  await initialization;
  trainer?.free();
  trainer = new AcousticModelTrainer(model);
};
const addTrainingRecording = (
  wav: string,
  bytes: Uint8Array,
  phones: string[]
) => {
  if (!trainer) {
    throw new Error("学習の準備ができていません。");
  }
  trainer.add(wav, bytes, phones);
};
const finishTraining = () => {
  if (!trainer) {
    throw new Error("学習の準備ができていません。");
  }
  try {
    return trainer.train((completed, total) => {
      postMessage({ kind: "training-progress", completed, total });
    });
  } finally {
    trainer.free();
    trainer = undefined;
  }
};
const api = { align, prepareTraining, addTrainingRecording, finishTraining };
export type AlignmentWorker = typeof api;
expose(api);
