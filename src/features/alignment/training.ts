import {
  Datasets,
  FeatureFiles,
  Model,
  SegmentationDocument,
  TrainingOptions,
} from "@shiro-rs/wasm/bundler";
import type { IterationReport, TrainingResult } from "@shiro-rs/wasm/bundler";

import { alignRecording } from "./inference";
import type { AcousticModel } from "./types";

const MAX_FEATURE_BYTES = 256 * 1024 * 1024;
const ITERATIONS = 3;

/** Worker内の1回の推定に使う音源別コーパス。WAV自体は保持しない。 */
export class AcousticModelTrainer {
  private readonly files = new FeatureFiles();
  private readonly documents: { filename: string; states: unknown }[] = [];
  private frames = 0;
  private bytes = 0;
  private readonly source: AcousticModel;

  constructor(source: AcousticModel) {
    this.source = source;
  }

  add(wav: string, bytes: Uint8Array, phones: string[]) {
    alignRecording(this.source, bytes, phones, (data) => {
      if (this.bytes + data.values.byteLength > MAX_FEATURE_BYTES) {
        throw new Error(
          "学習用の音声特徴量が256MiBを超えました。対象WAVを減らしてください。"
        );
      }
      const filename = `${this.documents.length}:${wav}.param`;
      const states: unknown = JSON.parse(data.states);
      this.files.set(filename, data.values);
      this.documents.push({ filename, states });
      this.frames = Math.max(this.frames, data.frames);
      this.bytes += data.values.byteLength;
    });
  }

  train(onProgress: (completed: number, total: number) => void): AcousticModel {
    if (this.documents.length === 0) {
      throw new Error("学習する録音がありません。");
    }
    const owners: { free: () => void }[] = [];
    const own = <T extends { free: () => void }>(owner: T): T => {
      owners.push(owner);
      return owner;
    };
    try {
      let model = own(Model.read(new Uint8Array(this.source.parameters)));
      model.validate();
      const document = own(
        new SegmentationDocument(JSON.stringify({ file_list: this.documents }))
      );
      for (const [stage, mode] of [1, 0].entries()) {
        const datasets = Datasets.load_training_files(
          document,
          model,
          this.files,
          this.frames,
          false
        );
        const options = new TrainingOptions();
        options.duration_mode = mode;
        options.iterations = ITERATIONS;
        options.state_radius = 60;
        options.duration_extra = 80;
        options.deterministic_annealing = true;
        options.termination_threshold = 0;
        options.workers = 1;
        let result: TrainingResult | undefined;
        try {
          result = model.train_with_progress(
            datasets,
            options,
            (report: IterationReport) => {
              try {
                if (!Number.isFinite(report.mean_log_likelihood)) {
                  throw new TypeError(
                    "モデル学習が収束しませんでした。対象録音と発音列を確認してください。"
                  );
                }
                onProgress(
                  stage * ITERATIONS + report.iteration + 1,
                  ITERATIONS * 2
                );
              } finally {
                report.free();
              }
            }
          );
          model = own(result.model());
          model.validate();
        } finally {
          result?.free();
          options.free();
          datasets.free();
        }
      }
      return {
        ...this.source,
        id: "adapted",
        name: `${this.source.name}（対象音源に適合）`,
        parameters: Uint8Array.from(model.write()).buffer,
      };
    } finally {
      for (const owner of owners.toReversed()) {
        owner.free();
      }
    }
  }

  free() {
    this.files.free();
  }
}
