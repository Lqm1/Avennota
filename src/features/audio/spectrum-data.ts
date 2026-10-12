import { releaseProxy, transfer, wrap } from "comlink";
import type { Remote } from "comlink";
import { useEffect, useState, useRef, useLayoutEffect } from "react";

import type { VoiceFolder } from "../../platform/files";
import type { SpectrumWorker } from "../../workers/spectrum";
import type { EditorSettings } from "../editor/settings";
import { errorText, notify } from "../editor/store";
import type { ParsedOtoLine } from "../oto/oto-set";
import { loadWaveSegment } from "./wave-segment";

const keyFor = (
  folder: VoiceFolder,
  wav: string,
  line: ParsedOtoLine,
  settings: EditorSettings,
  version: number
) =>
  JSON.stringify([
    folder.name,
    wav,
    settings.advanced.partialRead ? line.id : "",
    settings.autoFocus,
    [
      settings.advanced.sampleRate,
      settings.advanced.windowLength,
      settings.advanced.window,
      settings.advanced.preEmphasis,
      settings.advanced.brightness,
      settings.advanced.contrast,
      settings.advanced.partialRead,
      settings.advanced.partialBefore,
      settings.advanced.partialAfter,
    ],
    settings.fftSamples,
    version,
  ]);
const computeSpectrum = async (
  blob: Blob,
  settings: EditorSettings,
  compute: Remote<SpectrumWorker>,
  signal: AbortSignal
): Promise<string> => {
  const decoder = new OfflineAudioContext(1, 1, settings.advanced.sampleRate);
  const buffer = await decoder.decodeAudioData(await blob.arrayBuffer());
  signal.throwIfAborted();
  const samples = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = (samples[i] ?? 0) + (data[i] ?? 0) / buffer.numberOfChannels;
    }
  }
  return await compute(
    transfer(samples, [samples.buffer]),
    buffer.sampleRate,
    settings.advanced,
    settings.fftSamples
  );
};
export const useSpectrumData = (
  folder: VoiceFolder,
  wav: string,
  line: ParsedOtoLine,
  settings: EditorSettings,
  version: number
): string | null => {
  const [data, setData] = useState<{
    key: string;
    folder: VoiceFolder;
    url: string;
  } | null>(null);
  const inputs = useRef({ line, settings });
  useLayoutEffect(() => {
    inputs.current = { line, settings };
  }, [line, settings]);
  const { showSpec } = settings;
  const key = keyFor(folder, wav, line, settings, version);
  useEffect(() => {
    const register = () => {
      const { line: selectedLine, settings: currentSettings } = inputs.current;
      let disposed = false;
      const controller = new AbortController();
      let url: string | null = null;
      const worker = new Worker(
        new URL("../../workers/spectrum.ts", import.meta.url),
        { type: "module" }
      );
      const compute = wrap<SpectrumWorker>(worker);
      worker.addEventListener("error", () => {
        if (!disposed) {
          notify("error", "スペクトログラム解析Workerを起動できません。");
        }
      });
      const run = async () => {
        try {
          const segment = await loadWaveSegment(
            folder,
            wav,
            selectedLine.parsed.oto,
            currentSettings
          );
          const json = await computeSpectrum(
            segment.blob,
            currentSettings,
            compute,
            controller.signal
          );
          if (disposed) {
            return;
          }
          url = URL.createObjectURL(
            new Blob([json], { type: "application/json" })
          );
          setData({ key, folder, url });
        } catch (error) {
          if (!disposed) {
            notify("error", errorText(error));
          }
        }
      };
      void run();
      return () => {
        disposed = true;
        controller.abort();
        compute[releaseProxy]();
        worker.terminate();
        if (url !== null) {
          URL.revokeObjectURL(url);
        }
      };
    };
    return showSpec ? register() : undefined;
  }, [folder, key, showSpec, wav]);
  return data?.key === key && data.folder === folder ? data.url : null;
};
