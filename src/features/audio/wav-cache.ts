import { createStore, useSelector } from "@tanstack/react-store";

import type { VoiceFolder } from "../../platform/files";

const LIMIT = 24;
const caches = new WeakMap<VoiceFolder, Map<string, Promise<Blob>>>();
export const invalidateWavBlob = (folder: VoiceFolder, name: string): void => {
  caches.get(folder)?.delete(name.toLowerCase());
};

const readWav = async (
  folder: VoiceFolder,
  name: string,
  onError: () => void
): Promise<Blob> => {
  try {
    const bytes = await folder.read(name);
    return new Blob([bytes], { type: "audio/wav" });
  } catch (error) {
    onError();
    throw error;
  }
};

/** 音源フォルダからは読むだけで、ブラウザ内へ複製しない。 */
export const loadWavBlob = async (
  folder: VoiceFolder,
  name: string
): Promise<Blob> => {
  let cache = caches.get(folder);
  if (!cache) {
    cache = new Map();
    caches.set(folder, cache);
  }
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return await cached;
  }
  const loading = readWav(folder, name, () => {
    cache.delete(key);
  });
  cache.set(key, loading);
  if (cache.size > LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  return await loading;
};

/** デコード済みWAVの長さ（ミリ秒）。 */
export type Durations = ReadonlyMap<string, number>;
export const EMPTY_DURATIONS: Durations = new Map();
export const durationStore = createStore<ReadonlyMap<VoiceFolder, Durations>>(
  new Map()
);

export const setDuration = (
  folder: VoiceFolder,
  wav: string,
  durationMs: number
): void => {
  const key = wav.toLowerCase();
  durationStore.setState((state) => {
    const durations = state.get(folder) ?? EMPTY_DURATIONS;
    if (durations.get(key) === durationMs) {
      return state;
    }
    return new Map(state).set(folder, new Map(durations).set(key, durationMs));
  });
};

export const useDuration = (
  folder: VoiceFolder,
  wav: string
): number | undefined =>
  useSelector(durationStore, (state) =>
    state.get(folder)?.get(wav.toLowerCase())
  );
