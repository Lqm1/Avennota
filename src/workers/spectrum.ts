import { expose } from "comlink";
import { computeFrequencies } from "wavesurfer.js/dist/spectrogram-frequencies.js";

import type { AdvancedSettings } from "../features/editor/advanced-settings";

const computeSpectrum = (
  samples: Float32Array,
  rate: number,
  advanced: AdvancedSettings,
  fftSamples: number
) => {
  const filtered = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    filtered[i] =
      (samples[i] ?? 0) - advanced.preEmphasis * (samples[i - 1] ?? 0);
  }
  const data = computeFrequencies([filtered], {
    sampleRate: rate,
    fftSamples: Math.min(advanced.windowLength, fftSamples),
    fftSize: fftSamples,
    windowFunc: advanced.window,
    preEmphasis: 0,
    scale: "linear",
    gainDB: 20 + advanced.brightness,
    rangeDB: Math.max(1, 80 - advanced.contrast * 0.7),
  });
  return JSON.stringify(
    data.map((channel) => channel.map((frame) => [...frame]))
  );
};

export type SpectrumWorker = typeof computeSpectrum;

expose(computeSpectrum);
