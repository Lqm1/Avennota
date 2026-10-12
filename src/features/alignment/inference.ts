import {
  AlignmentOptions,
  Audio,
  AudioOptions,
  batch_feature_options,
  DitherSequence,
  Features,
  Labels,
  Model,
  Observation,
  PhoneMap,
  rawfloat_write,
  Wave,
} from "@shiro-rs/wasm/web";

import type { AcousticModel, AlignmentResult, PhoneInterval } from "./types";

/** 初期化済みWASMで実行する。Worker以外から重い推定を呼ばない。 */
export const alignRecording = (
  modelData: AcousticModel,
  bytes: Uint8Array,
  phones: string[],
  onFeatures?: (data: {
    values: Uint8Array;
    states: string;
    frames: number;
  }) => void
): AlignmentResult => {
  const owners: { free: () => void }[] = [];
  const own = <T extends { free: () => void }>(owner: T): T => {
    owners.push(owner);
    return owner;
  };
  try {
    if (phones.length === 0 || phones.some((phone) => phone.trim() === "")) {
      throw new Error("推定する音素列が空です。");
    }
    const model = own(Model.read(new Uint8Array(modelData.parameters)));
    model.validate();
    const map = own(new PhoneMap(modelData.phonemap));
    const wave = own(Wave.read(bytes, 30_000_000));
    const duration = wave.samples().length / wave.sample_rate;
    const audioOptions = own(new AudioOptions());
    audioOptions.output_sample_rate = 16_000;
    audioOptions.dither_level = 0.01;
    const random = own(DitherSequence.linux_gnu());
    const audio = own(Audio.prepare_with_sequence(wave, audioOptions, random));
    const featureOptions = own(batch_feature_options(0));
    const features = own(Features.extract(audio.samples(), featureOptions));
    const dimensions = model.dimensions();
    if (dimensions.reduce((sum, size) => sum + size, 0) !== features.columns) {
      throw new Error("モデルは16kHz・36次元MFCC（Δ・ΔΔ）に対応していません。");
    }
    const observation = own(
      Observation.from_model_rawfloat(
        rawfloat_write(features.values()),
        model,
        features.frames
      )
    );
    const padded = ["pau", ...phones, "pau"];
    const states = own(map.initial(padded, features.frames));
    const coarseOptions = own(new AlignmentOptions());
    coarseOptions.duration_mode = 1;
    const coarse = own(model.align_states(observation, states, coarseOptions));
    const refinedOptions = own(new AlignmentOptions());
    refinedOptions.state_radius = 60;
    refinedOptions.duration_extra = 80;
    const refined = own(
      model.align_states(observation, coarse, refinedOptions)
    );
    const labels = own(Labels.from_states(refined, 0.005, false));
    onFeatures?.({
      values: rawfloat_write(features.values()),
      states: refined.json(),
      frames: features.frames,
    });
    const intervals: PhoneInterval[] = [];
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels.get(index);
      if (!label) {
        throw new Error("推定された音素区間が欠けています。");
      }
      try {
        if (
          !Number.isFinite(label.start) ||
          !Number.isFinite(label.end) ||
          label.start < 0 ||
          label.end < label.start ||
          label.start > duration ||
          label.end > duration + 0.005
        ) {
          throw new Error("推定された音素区間が原音の範囲に収まりません。");
        }
        intervals.push({
          name: label.name,
          start: label.start,
          end: Math.min(duration, label.end),
        });
      } finally {
        label.free();
      }
    }
    if (
      intervals.length !== padded.length ||
      intervals.some((interval, index) => interval.name !== padded[index]) ||
      intervals.slice(1, -1).some((interval) => interval.end <= interval.start)
    ) {
      throw new Error("推定結果の音素列が入力と一致しません。");
    }
    return { duration, intervals: intervals.slice(1, -1) };
  } finally {
    for (const owner of owners.toReversed()) {
      owner.free();
    }
  }
};
