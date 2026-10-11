import { cellSelectionStore, selectedCells } from "../editor/cell-selection";
import { settingsStore } from "../editor/settings";
import { editorStore, errorText, notify } from "../editor/store";
import { cutoffEnd } from "../oto/geometry";
import { isOtoLine } from "../oto/oto-set";
import { timingClickCollection } from "./timing-click-storage";
import { loadWavBlob } from "./wav-cache";
import { waveControls } from "./wave-controls";

export interface TimingClip {
  samples: Float32Array;
  offset: number;
  preutter: number;
  end: number;
}
/** 先行発声をプリカウント後の拍へ合わせ、長い先行部分を半拍/一拍へ制限する。 */
export const mixTimingClips = (
  clips: TimingClip[],
  click: Float32Array,
  sampleRate: number,
  options: { tempo: number; preCount: number; mix: number }
): Float32Array => {
  const beat = Math.floor((sampleRate * 60) / options.tempo);
  const clickLength = beat * (options.preCount + 1);
  let output = new Float32Array(0);
  for (const clip of clips) {
    let start = Math.floor((clip.offset * sampleRate) / 1000);
    const p = Math.floor((clip.preutter * sampleRate) / 1000);
    const end = Math.min(
      clip.samples.length,
      Math.floor((clip.end * sampleRate) / 1000) + 1
    );
    const lead = p - start;
    if (lead > beat) {
      start = p - beat;
    } else if (lead > beat / 2) {
      start = p - Math.floor(beat / 2);
    }
    const mixStart = output.length + options.preCount * beat - (p - start);
    const segmentLength = Math.max(0, end - start);
    const next = new Float32Array(
      Math.max(output.length + clickLength, mixStart + segmentLength)
    );
    next.set(output);
    for (let b = 0; b <= options.preCount; b += 1) {
      const at = output.length + b * beat;
      for (let i = 0; i < Math.min(beat, click.length); i += 1) {
        next[at + i] = (click[i] ?? 0) * (1 - options.mix);
      }
    }
    for (let i = 0; i < segmentLength; i += 1) {
      const at = mixStart + i;
      if (at >= 0 && at < next.length) {
        next[at] = Math.max(
          -1,
          Math.min(
            1,
            (next[at] ?? 0) + (clip.samples[start + i] ?? 0) * options.mix
          )
        );
      }
    }
    output = next;
  }
  return output;
};

let context: AudioContext | null = null;
let player: AudioBufferSourceNode | null = null;
let request = 0;
export const resetTimingClick = async (): Promise<boolean> => {
  try {
    const collection = await timingClickCollection();
    if (collection.has("timing-click")) {
      await collection.delete("timing-click").when("settled");
    }
    notify("info", "内蔵クリック音に戻しました。");
    return true;
  } catch (error) {
    notify("error", `クリック音を初期化できません: ${String(error)}`);
    return false;
  }
};
export const stopTiming = (): void => {
  request += 1;
  if (player !== null) {
    player.stop();
    player = null;
  }
};
export const setTimingClick = async (file: File): Promise<boolean> => {
  try {
    context ??= new AudioContext({ sampleRate: 44_100 });
    const bytes = await file.arrayBuffer();
    await context.decodeAudioData(structuredClone(bytes));
    const collection = await timingClickCollection();
    const transaction = collection.has("timing-click")
      ? collection.update("timing-click", (clip) => {
          clip.bytes = bytes;
        })
      : collection.insert({ id: "timing-click", bytes });
    await transaction.when("settled");
    notify("info", `クリック音を「${file.name}」に変更しました。`);
    return true;
  } catch (error) {
    notify("error", `クリック音を読み込めません: ${errorText(error)}`);
    return false;
  }
};
const mono = (audio: AudioBuffer): Float32Array => {
  const result = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const samples = audio.getChannelData(channel);
    for (let i = 0; i < result.length; i += 1) {
      result[i] = (result[i] ?? 0) + (samples[i] ?? 0) / audio.numberOfChannels;
    }
  }
  return result;
};
const defaultClick = (rate: number): Float32Array => {
  const click = new Float32Array(Math.round(rate * 0.04));
  for (let i = 0; i < click.length; i += 1) {
    click[i] =
      Math.sin((i * 2 * Math.PI * 1600) / rate) *
      Math.exp(-i / (rate * 0.006)) *
      0.8;
  }
  return click;
};
export const playTiming = async (): Promise<void> => {
  if (player !== null) {
    stopTiming();
    return;
  }
  waveControls()?.stop();
  request += 1;
  const token = request;
  const { workspace } = editorStore.state;
  if (workspace.kind === "closed") {
    return;
  }
  const { otoSet, selectedId } = workspace.history.present;
  const ids = new Set(
    selectedCells(otoSet, cellSelectionStore.state, selectedId).map(
      (cell) => cell.lineId
    )
  );
  const rows = otoSet.lines
    .filter(isOtoLine)
    .filter((line) => ids.has(line.id));
  if (rows.length > 20) {
    notify("warning", "発声タイミング試聴は先頭20行を再生します。");
  }
  try {
    context ??= new AudioContext({ sampleRate: 44_100 });
    const audioContext = context;
    await audioContext.resume();
    const clips = await Promise.all(
      rows.slice(0, 20).map(async (line): Promise<TimingClip> => {
        const { oto } = line.parsed;
        const name = workspace.session.wavs.get(oto.wav.toLowerCase());
        if (name === undefined) {
          throw new Error(`${oto.wav}がありません。`);
        }
        const blob = await loadWavBlob(workspace.session.folder, name);
        const bytes = await blob.arrayBuffer();
        const buffer = await audioContext.decodeAudioData(bytes);
        return {
          samples: mono(buffer),
          offset: oto.offset,
          preutter: oto.offset + oto.preutter,
          end: cutoffEnd(oto, buffer.duration * 1000),
        };
      })
    );
    const collection = await timingClickCollection();
    const stored = collection.get("timing-click")?.bytes;
    const click =
      stored instanceof ArrayBuffer
        ? mono(await audioContext.decodeAudioData(structuredClone(stored)))
        : defaultClick(audioContext.sampleRate);
    const mixed = mixTimingClips(
      clips,
      click,
      audioContext.sampleRate,
      settingsStore.state.timing
    );
    if (token !== request || mixed.length === 0) {
      return;
    }
    const buffer = audioContext.createBuffer(
      1,
      mixed.length,
      audioContext.sampleRate
    );
    buffer.getChannelData(0).set(mixed);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.addEventListener(
      "ended",
      () => {
        if (player === source) {
          player = null;
        }
        source.disconnect();
      },
      { once: true }
    );
    player = source;
    source.start();
  } catch (error) {
    if (token === request) {
      notify("error", `発声タイミング試聴に失敗しました: ${errorText(error)}`);
    }
  }
};
