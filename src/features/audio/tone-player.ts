import { errorText, notify } from "../editor/store";
import { AudioPlayback } from "./audio-playback";
import { timingPlayback } from "./timing-player";
import { waveControls } from "./wave-controls";

export const tonePlayback = new AudioPlayback();

export const playTone = async (frequency: number): Promise<void> => {
  const token = tonePlayback.begin();
  timingPlayback.stop();
  waveControls()?.stop();
  try {
    const context = await tonePlayback.audioContext();
    const buffer = context.createBuffer(
      1,
      context.sampleRate,
      context.sampleRate
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      const phase = ((i * frequency) / context.sampleRate) % 1;
      const triangle = phase < 0.01 ? phase / 0.01 : (1 - phase) / 0.99;
      data[i] = ((2 * triangle - 1) * 4000) / 32_768;
    }
    for (const [center, bandwidth] of [
      [500, 50],
      [1500, 75],
      [2500, 100],
      [3500, 150],
    ] as const) {
      const radius = Math.exp((-Math.PI * bandwidth) / context.sampleRate);
      const first =
        2 * radius * Math.cos((2 * Math.PI * center) / context.sampleRate);
      const second = radius ** 2;
      let previous = 0;
      let older = 0;
      for (let i = 0; i < data.length; i += 1) {
        const value = (data[i] ?? 0) + first * previous - second * older;
        data[i] = value;
        older = previous;
        previous = value;
      }
    }
    let peak = 0;
    for (const value of data) {
      peak = Math.max(peak, Math.abs(value));
    }
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (((data[i] ?? 0) / Math.max(1, peak)) * 4000) / 32_768;
    }
    tonePlayback.start(token, buffer);
  } catch (error) {
    notify("error", `音高を試聴できません: ${errorText(error)}`);
  } finally {
    tonePlayback.finish(token);
  }
};
