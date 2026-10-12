import {
  batch_feature_options,
  Dataset,
  FeatureFiles,
  Features,
  InitializationOptions,
  PhoneMap,
  PhoneMapOptions,
  rawfloat_write,
  SegmentationDocument,
} from "@shiro-rs/wasm/bundler";
import { describe, expect, it } from "vitest";

import { encodePcmWave } from "../audio/wav-processing";
import { alignRecording } from "./inference";
import { AcousticModelTrainer } from "./training";
import type { AcousticModel } from "./types";

const fixture = (): { model: AcousticModel; wav: Uint8Array } => {
  const owners: { free: () => void }[] = [];
  const own = <T extends { free: () => void }>(owner: T): T => {
    owners.push(owner);
    return owner;
  };
  try {
    const samples = Float32Array.from({ length: 32_000 }, (_, index) =>
      index < 4000 || index >= 28_000
        ? 0
        : 0.25 * Math.sin((index * 2 * Math.PI * 220) / 16_000)
    );
    const options = own(new PhoneMapOptions());
    options.states_per_phone = 3;
    options.streams = 3;
    const map = own(PhoneMap.create("pau\na\n", options));
    const featureOptions = own(batch_feature_options(0));
    const features = own(Features.extract(samples, featureOptions));
    const definition = own(map.to_definition(12, 0.005));
    const model = own(definition.build());
    const states = own(map.initial(["pau", "a", "pau"], features.frames));
    const stateValues: unknown = JSON.parse(states.json());
    const document = own(
      new SegmentationDocument(
        JSON.stringify({
          file_list: [{ filename: "test.param", states: stateValues }],
        })
      )
    );
    const files = own(new FeatureFiles());
    files.set("test.param", rawfloat_write(features.values()));
    const dataset = own(Dataset.load(document, model, files, features.frames));
    const initialization = own(new InitializationOptions());
    initialization.flat_start = true;
    initialization.globally_tied = true;
    initialization.variance_floor_ratio = 1;
    const initialized = own(model.initialize(dataset, initialization));
    return {
      model: {
        id: "test",
        name: "合成波形から初期化したテスト用モデル",
        parameters: Uint8Array.from(initialized.write()).buffer,
        phonemap: map.json(),
      },
      wav: encodePcmWave({
        rate: 16_000,
        channels: [samples],
        bits: 16,
        floating: false,
      }),
    };
  } finally {
    for (const owner of owners.toReversed()) {
      owner.free();
    }
  }
};

describe("SHIROの実WASMによる推定", () => {
  it("WAVデコードからMFCC・HMM・HSMMを実行し原音基準の秒数を返す", () => {
    const { model, wav } = fixture();
    const result = alignRecording(model, wav, ["a"]);
    expect(result.duration).toBe(2);
    expect(result.intervals).toHaveLength(1);
    const [interval] = result.intervals;
    expect(interval).toMatchObject({ name: "a" });
    expect(interval?.start).toBeGreaterThanOrEqual(0);
    expect(interval?.end).toBeLessThanOrEqual(2);
  });

  it("同じ原音の再実行で同じ境界を返す", () => {
    const { model, wav } = fixture();
    const result = alignRecording(model, wav, ["a"]);
    const [interval] = result.intervals;
    expect(interval?.end).toBeGreaterThan(interval?.start ?? 0);
    expect(alignRecording(model, wav, ["a"])).toStrictEqual(result);
  });

  it("不明音素・壊れたWAVで失敗しても次の推定ができる", () => {
    const { model, wav } = fixture();
    expect(() => alignRecording(model, wav, ["unknown"])).toThrow(
      /phone|phoneme|unknown/iu
    );
    expect(() => alignRecording(model, new Uint8Array([1, 2]), ["a"])).toThrow(
      "failed to fill whole buffer"
    );
    expect(() => alignRecording(model, wav, [])).toThrow("空");
    expect(alignRecording(model, wav, ["a"]).intervals).toHaveLength(1);
  });

  it("音源別にHMM・HSMMを学習し、学習後のモデルで再推定できる", () => {
    const { model, wav } = fixture();
    const trainer = new AcousticModelTrainer(model);
    const progress: number[] = [];
    try {
      trainer.add("a.wav", wav, ["a"]);
      const adapted = trainer.train((completed) => {
        progress.push(completed);
      });
      expect(progress).toStrictEqual([1, 2, 3, 4, 5, 6]);
      expect(new Uint8Array(adapted.parameters)).not.toStrictEqual(
        new Uint8Array(model.parameters)
      );
      expect(alignRecording(adapted, wav, ["a"]).intervals).toHaveLength(1);
    } finally {
      trainer.free();
    }
  });
});
