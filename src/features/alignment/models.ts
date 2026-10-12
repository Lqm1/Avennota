import { z } from "zod";

import { acousticModelCollection, acousticModelSchema } from "./model-storage";
import type { AcousticModel } from "./types";

/** モデルとphonemapを同じリビジョンから取得する。 */
const MODEL_REVISION = "17694ca5dcfb3ba95ed5ea21fe86b7304d1fafa5";
export const JAPANESE_MODEL_ID = `intunist-jp6:${MODEL_REVISION}`;
const MODEL_ROOT = `https://raw.githubusercontent.com/intunist/SHIRO-Models-Japanese/${MODEL_REVISION}`;
const phonemapSchema = z
  .object({
    phone_map: z.record(
      z.string(),
      z
        .object({
          states: z
            .array(
              z
                .object({
                  dur: z.number().int().nonnegative(),
                  out: z.array(z.number().int().nonnegative()).min(1),
                })
                .loose()
            )
            .min(1),
        })
        .loose()
    ),
  })
  .loose();

export const phoneInventory = (phonemap: string): Set<string> =>
  new Set(Object.keys(phonemapSchema.parse(JSON.parse(phonemap)).phone_map));

const download = async (name: string, signal: AbortSignal) => {
  const response = await fetch(`${MODEL_ROOT}/${name}`, { signal });
  if (!response.ok) {
    throw new Error(
      `音響モデルの取得に失敗しました（HTTP ${response.status}）。`
    );
  }
  return response;
};

export const loadJapaneseModel = async (
  signal: AbortSignal
): Promise<AcousticModel> => {
  const collection = await acousticModelCollection();
  signal.throwIfAborted();
  const cached = collection.get(JAPANESE_MODEL_ID);
  if (cached) {
    phoneInventory(cached.phonemap);
    return acousticModelSchema.parse(cached);
  }
  const [parametersResponse, mapResponse] = await Promise.all([
    download("intunist-jp6_generic.hsmm", signal),
    download("intunist-jp6_phonemap.json", signal),
  ]);
  const parameters = await parametersResponse.arrayBuffer();
  const phonemap = await mapResponse.text();
  phoneInventory(phonemap);
  if (parameters.byteLength === 0) {
    throw new Error("取得した音響モデルが空です。");
  }
  signal.throwIfAborted();
  const model: AcousticModel = {
    id: JAPANESE_MODEL_ID,
    name: "Intunist 日本語歌唱モデル（汎用）",
    parameters,
    phonemap,
  };
  const existing = collection.get(model.id);
  if (existing) {
    return acousticModelSchema.parse(existing);
  }
  await collection.insert(model).when("settled");
  signal.throwIfAborted();
  return model;
};
