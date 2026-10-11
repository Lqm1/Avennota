import { PitchDetector } from "pitchy";

import type { AdvancedSettings } from "../editor/advanced-settings";

export interface AnalysisPoint {
  time: number;
  value: number;
}
export interface AudioAnalysis {
  power: AnalysisPoint[];
  pitch: AnalysisPoint[];
}
export const windowWeight = (
  i: number,
  length: number,
  kind: AdvancedSettings["window"]
): number => {
  const x = i / Math.max(1, length - 1);
  switch (kind) {
    case "hamming": {
      return 0.54 - 0.46 * Math.cos(2 * Math.PI * x);
    }
    case "hann": {
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
    }
    case "bartlett": {
      return 1 - Math.abs(2 * x - 1);
    }
    case "blackman": {
      return (
        0.42 -
        0.5 * Math.cos(2 * Math.PI * x) +
        0.08 * Math.cos(4 * Math.PI * x)
      );
    }
    case "rectangular": {
      return 1;
    }
    default: {
      return 1;
    }
  }
};
const firstPeriod = (
  scores: number[],
  minLag: number,
  bestLag: number,
  best: number,
  rms: number
): number => {
  let lagAt = bestLag;
  // 同等のピークでは最初の周期を採り、整数倍周期によるオクターブ誤りを抑える。
  for (let lag = minLag + 1; lag < lagAt; lag += 1) {
    const score = scores[lag] ?? 0;
    const peak =
      score < (scores[lag - 1] ?? 0) &&
      score <= (scores[lag + 1] ?? 0) &&
      score <= Math.max(best * 1.2, rms * 0.1);
    if (peak) {
      lagAt = lag;
      break;
    }
  }

  return lagAt;
};
const estimatePitch = (
  frame: Float32Array,
  pitchRate: number,
  options: AdvancedSettings,
  energy: number
): number => {
  const win = frame.length;
  const minLag = Math.max(2, Math.floor(pitchRate / options.pitchMax));
  const maxLag = Math.min(win - 2, Math.ceil(pitchRate / options.pitchMin));
  let best = Number.POSITIVE_INFINITY;
  let lagAt = 0;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let cross = 0;
    for (let i = 0; i < win - lag; i += 1) {
      const a = frame[i] ?? 0;
      const b = frame[i + lag] ?? 0;
      cross += Math.abs(a - b);
    }
    const score = cross / (win - lag);
    scores[lag] = score;
    if (score < best) {
      best = score;
      lagAt = lag;
    }
  }
  lagAt = firstPeriod(scores, minLag, lagAt, best, Math.sqrt(energy / win));
  const voiced =
    energy / win > 1e-5 && lagAt > 0 && best < Math.sqrt(energy / win) * 0.6;

  return voiced ? pitchRate / lagAt : 0;
};
const detectMpm = (
  detector: PitchDetector<Float32Array>,
  frame: Float32Array,
  rate: number,
  options: AdvancedSettings
): number => {
  const [frequency, clarity] = detector.findPitch(frame, rate);
  return clarity >= 0.9 &&
    frequency >= options.pitchMin &&
    frequency <= options.pitchMax
    ? frequency
    : 0;
};
const analyzePitch = (
  samples: Float32Array,
  rate: number,
  options: AdvancedSettings
): AnalysisPoint[] => {
  const pitch: AnalysisPoint[] = [];
  if (!options.showPitch) {
    return pitch;
  }
  // MPMはFFTを利用して元のサンプルレートで解析する。
  const stride =
    options.pitchMethod === "mpm"
      ? 1
      : Math.max(1, Math.floor(rate / Math.max(8000, options.pitchMax * 3)));
  const pitchRate = rate / stride;
  // 抽出下限の3周期を確保し、短い窓でも低音の検出を安定させる。
  const win = Math.max(
    4,
    Math.round((pitchRate * options.pitchWindow) / 1000),
    Math.ceil((3 * pitchRate) / options.pitchMin)
  );
  const detector = PitchDetector.forFloat32Array(win);
  detector.minVolumeAbsolute = Math.sqrt(1e-5);
  const frame = new Float32Array(win);
  const step = Math.max(1, Math.round((rate * options.pitchStep) / 1000));
  for (let at = 0; at + win * stride <= samples.length; at += step) {
    let mean = 0;
    for (let i = 0; i < win; i += 1) {
      mean += samples[at + i * stride] ?? 0;
    }
    mean /= win;
    let energy = 0;
    for (let i = 0; i < win; i += 1) {
      const value = (samples[at + i * stride] ?? 0) - mean;
      frame[i] = value;
      energy += value * value;
    }
    pitch.push({
      time: (at + (win * stride) / 2) / rate,
      value:
        options.pitchMethod === "mpm"
          ? detectMpm(detector, frame, pitchRate, options)
          : estimatePitch(frame, pitchRate, options, energy),
    });
  }

  return pitch;
};
const resample = (
  samples: Float32Array,
  rate: number,
  targetRate: number
): Float32Array => {
  if (rate === targetRate) {
    return samples;
  }
  const output = new Float32Array(
    Math.round((samples.length * targetRate) / rate)
  );
  for (let i = 0; i < output.length; i += 1) {
    const position = (i * rate) / targetRate;
    const left = Math.floor(position);
    const fraction = position - left;
    output[i] =
      (samples[left] ?? 0) * (1 - fraction) +
      (samples[left + 1] ?? 0) * fraction;
  }
  return output;
};
export const analyzeAudio = (
  input: Float32Array,
  inputRate: number,
  options: AdvancedSettings
): AudioAnalysis => {
  const rate = options.sampleRate;
  const samples = resample(input, inputRate, rate);
  const power: AnalysisPoint[] = [];
  const pLength = Math.max(2, Math.round((rate * options.powerWindow) / 1000));
  const pStep = Math.max(1, Math.round((rate * options.powerStep) / 1000));
  if (options.showPower) {
    for (let at = 0; at + pLength <= samples.length; at += pStep) {
      let sum = 0;
      for (let i = 0; i < pLength; i += 1) {
        const filtered =
          (samples[at + i] ?? 0) -
          options.powerPreEmphasis * (samples[at + i - 1] ?? 0);
        sum +=
          (filtered * windowWeight(i, pLength, options.powerWindowKind)) ** 2;
      }
      power.push({
        time: (at + pLength / 2) / rate,
        value: 10 * Math.log10(Math.max(1e-12, sum / pLength)),
      });
    }
  }
  const pitch = analyzePitch(samples, rate, options);
  return { power, pitch };
};
