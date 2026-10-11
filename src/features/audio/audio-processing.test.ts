import { describe, expect, it, vi } from "vitest";

import type { VoiceFolder } from "../../platform/files";
import { DEFAULT_ADVANCED } from "../editor/advanced-settings";
import { DEFAULT_SETTINGS } from "../editor/settings";
import { cutoffEnd } from "../oto/geometry";
import { parseLine } from "../oto/oto-set";
import { analyzeAudio } from "./analysis";
import {
  decodePcmWave,
  encodePcmWave,
  processWave,
  trimOto,
  adjustTrimBlanks,
} from "./wav-processing";
import { loadWaveSegment } from "./wave-segment";

const oto = () => {
  const line = parseLine("a.wav=a,200,400,-1300,150,-50");
  if (line.kind !== "oto") {
    throw new Error("Invalid fixture");
  }
  return line.oto;
};
const sine = (rate: number, hz: number) =>
  Float32Array.from(
    { length: rate / 5 },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate)
  );
describe("WAV加工と解析", () => {
  it("DCフィルターは定数入力の過渡応答を保持し、徐々に減衰する", () => {
    const result = processWave(
      {
        rate: 8000,
        bits: 32,
        floating: true,
        channels: [new Float32Array(1000).fill(0.5)],
      },
      { dc: true, mono: false, headMs: 0, tailMs: 0 }
    );
    expect(result.channels[0]?.[0]).toBeCloseTo(0.495, 6);
    expect(result.channels[0]?.[99]).toBeCloseTo(0.5 * 0.99 ** 100, 6);
    expect(result.channels[0]?.[999]).toBeLessThan(0.00003);
  });

  it("両端カットの任意補正は相対パラメータと負の右ブランクを保持する", () => {
    const source = oto();
    const corrected = adjustTrimBlanks(source, 300, 100);
    expect({
      offset: corrected.offset,
      cutoff: corrected.cutoff,
      preutter: corrected.preutter,
      overlap: corrected.overlap,
      consonant: corrected.consonant,
    }).toStrictEqual({
      offset: 0,
      cutoff: source.cutoff,
      preutter: source.preutter,
      overlap: source.overlap,
      consonant: source.consonant,
    });
    expect(adjustTrimBlanks({ ...source, cutoff: 500 }, 50, 100).cutoff).toBe(
      400
    );
  });

  it.each([8, 16, 24, 32])(
    "%ibit PCMの左右チャンネルと符号を保持する",
    (bits) => {
      const left = new Float32Array([-1, -0.25, 0, 0.5, 0.99]);
      const right = new Float32Array([0.75, 0, -0.5, 0.2, -0.99]);
      const decoded = decodePcmWave(
        encodePcmWave({
          rate: 44_100,
          channels: [left, right],
          bits,
          floating: false,
        })
      );
      expect(decoded.rate).toBe(44_100);
      expect(decoded.channels).toHaveLength(2);
      for (const [channel, source] of [left, right].entries()) {
        for (const [index, value] of source.entries()) {
          expect(decoded.channels[channel]?.[index]).toBeCloseTo(
            value,
            bits === 8 ? 2 : 4
          );
        }
      }
    }
  );

  it("浮動小数点PCMと奇数バイトのデータを読み戻す", () => {
    const float = decodePcmWave(
      encodePcmWave({
        rate: 8000,
        channels: [new Float32Array([-0.7, 0.2, 1])],
        bits: 32,
        floating: true,
      })
    );
    expect(float.floating).toBeTruthy();
    expect(float.channels[0]?.[0]).toBeCloseTo(-0.7, 6);
    expect(
      decodePcmWave(
        encodePcmWave({
          rate: 8000,
          channels: [new Float32Array([0, 0.5, -0.5])],
          bits: 8,
          floating: false,
        })
      ).channels[0]
    ).toHaveLength(3);
  });

  it("破損チャンク・圧縮形式・全カットを拒否する", () => {
    const wave = {
      rate: 1000,
      channels: [new Float32Array(10)],
      bits: 16,
      floating: false,
    };
    const bytes = encodePcmWave(wave);
    const view = new DataView(bytes.buffer);
    view.setUint16(20, 6, true);
    expect(() => decodePcmWave(bytes)).toThrow("PCM");
    expect(() => decodePcmWave(bytes.slice(0, 45))).toThrow("チャンク");
    expect(() =>
      processWave(wave, { dc: false, mono: false, headMs: 5, tailMs: 5 })
    ).toThrow("音声");
  });

  it("両端カット後のDC除去とモノラル化を原本を変えずに行う", () => {
    const original = {
      rate: 1000,
      channels: [
        new Float32Array([9, 0.2, 0.4, 0.6, 9]),
        new Float32Array([9, -0.4, 0, 0.4, 9]),
      ],
      bits: 32,
      floating: true,
    };
    const result = processWave(original, {
      dc: true,
      mono: true,
      headMs: 1,
      tailMs: 1,
    });
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]).toHaveLength(3);
    expect(result.channels[0]?.[0]).toBeCloseTo(-0.099);
    expect(result.channels[0]?.[2]).toBeCloseTo(0.4940001);
    expect(original.channels[0]?.[0]).toBe(9);
  });

  it("カットなしの音声加工では範囲外や負の原音設定値も変更しない", () => {
    const source = { ...oto(), overlap: -300, cutoff: -2500, preutter: -20 };
    expect(trimOto(source, 2000, 0, 0)).toBe(source);
  });

  it("カット後も各マーカーの絶対時刻と右ブランクの符号を維持する", () => {
    const source = oto();
    const negative = trimOto(source, 2000, 100, 200);
    expect([
      negative.offset,
      negative.preutter,
      negative.overlap,
    ]).toStrictEqual([100, 150, -50]);
    expect(cutoffEnd(negative, 1700)).toBe(1400);
    expect(negative.cutoff).toBe(-1300);
    const positive = trimOto({ ...source, cutoff: 500 }, 2000, 100, 200);
    expect([positive.cutoff, cutoffEnd(positive, 1700)]).toStrictEqual([
      300, 1400,
    ]);
  });

  it.each(["mpm", "amdf"] as const)(
    "%sで220Hzを検出し、無音は無声音になる",
    (pitchMethod) => {
      const options = {
        ...DEFAULT_ADVANCED,
        showPitch: true,
        showPower: true,
        pitchMethod,
        sampleRate: 16_000,
      };
      const analysis = analyzeAudio(sine(44_100, 220), 44_100, {
        ...options,
        pitchWindow: 40,
      });
      expect(analysis.pitch.length).toBeGreaterThan(10);
      for (const point of analysis.pitch) {
        expect(point.value).toBeGreaterThan(210);
        expect(point.value).toBeLessThan(230);
      }
      expect(analysis.power[0]?.value).toBeLessThan(-5);
      const quiet = analyzeAudio(new Float32Array(4410), 44_100, options);
      expect(quiet.pitch.every((point) => point.value === 0)).toBeTruthy();
    }
  );

  it("MPMは音高変化と無音を追跡する", () => {
    const rate = 16_000;
    const signal = Float32Array.from({ length: rate * 2 }, (_, i) =>
      i < rate * 1.5
        ? 0.5 *
          Math.sin((2 * Math.PI * (i < rate * 0.75 ? 110 : 220) * i) / rate)
        : 0
    );
    const result = analyzeAudio(signal, rate, {
      ...DEFAULT_ADVANCED,
      sampleRate: rate,
      showPitch: true,
      pitchMethod: "mpm",
    });
    expect(result.pitch.length).toBeGreaterThan(180);
    expect(
      result.pitch
        .filter((point) => point.time > 0.2 && point.time < 0.6)
        .every((point) => Math.abs(point.value - 110) < 1)
    ).toBeTruthy();
    expect(
      result.pitch
        .filter((point) => point.time > 0.9 && point.time < 1.3)
        .every((point) => Math.abs(point.value - 220) < 1)
    ).toBeTruthy();
    expect(
      result.pitch
        .filter((point) => point.time > 1.7)
        .every((point) => point.value === 0)
    ).toBeTruthy();
  });

  it("部分読み込みで必要なPCM範囲だけ読み、原音全体の長さと開始位置を保持する", async () => {
    const bytes = encodePcmWave({
      rate: 1000,
      channels: [new Float32Array(10_000)],
      bits: 16,
      floating: false,
    });
    const readRange = vi.fn<NonNullable<VoiceFolder["readRange"]>>(
      async (_: string, at: number, size: number) =>
        await Promise.resolve(bytes.slice(at, at + size))
    );
    const read = vi.fn<VoiceFolder["read"]>(
      async () => await Promise.resolve(bytes)
    );
    const folder: VoiceFolder = {
      name: "partial",
      listFiles: async () => await Promise.resolve(["a.wav"]),
      ensureWritable: async () => await Promise.resolve(true),
      stat: async () =>
        await Promise.resolve({ size: bytes.length, modifiedAt: 0 }),
      read,
      readRange,
      write: vi.fn<VoiceFolder["write"]>(),
    };
    const loaded = await loadWaveSegment(
      folder,
      "a.wav",
      { ...oto(), offset: 5000 },
      {
        ...DEFAULT_SETTINGS,
        autoFocus: "offset",
        advanced: {
          ...DEFAULT_ADVANCED,
          partialRead: true,
          partialBefore: 100,
          partialAfter: 200,
        },
      }
    );

    const atStart = await loadWaveSegment(
      folder,
      "a.wav",
      { ...oto(), offset: 0 },
      {
        ...DEFAULT_SETTINGS,
        autoFocus: "offset",
        advanced: {
          ...DEFAULT_ADVANCED,
          partialRead: true,
          partialBefore: 100,
          partialAfter: 200,
        },
      }
    );
    expect(
      decodePcmWave(new Uint8Array(await atStart.blob.arrayBuffer()))
        .channels[0]
    ).toHaveLength(300);
    expect({
      readCalls: read.mock.calls.length,
      offset: loaded.offsetMs,
      duration: loaded.durationMs,
      startOffset: atStart.offsetMs,
    }).toStrictEqual({
      readCalls: 0,
      offset: 4900,
      duration: 10_000,
      startOffset: 0,
    });
    expect(
      decodePcmWave(new Uint8Array(await loaded.blob.arrayBuffer())).channels[0]
    ).toHaveLength(300);
    expect(
      readRange.mock.calls.some(([, at, size]) => at === 9844 && size === 600)
    ).toBeTruthy();
    const full = await loadWaveSegment(folder, "a.wav", oto(), {
      ...DEFAULT_SETTINGS,
      autoFocus: "none",
      advanced: { ...DEFAULT_ADVANCED, partialRead: true },
    });
    expect({
      offset: full.offsetMs,
      readCalls: read.mock.calls.length,
      frames: decodePcmWave(new Uint8Array(await full.blob.arrayBuffer()))
        .channels[0]?.length,
    }).toStrictEqual({ offset: 0, readCalls: 1, frames: 10_000 });
  });
});
