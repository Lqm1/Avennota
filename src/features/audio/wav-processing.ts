import { cutoffEnd } from "../oto/geometry";
import type { Oto } from "../oto/oto-set";
import { withParams } from "../oto/oto-set";

export interface PcmWave {
  rate: number;
  channels: Float32Array[];
  bits: number;
  floating: boolean;
}
const tag = (view: DataView, at: number): string =>
  String.fromCodePoint(
    ...Array.from({ length: 4 }, (_, i) => view.getUint8(at + i))
  );
const readSample = (
  view: DataView,
  at: number,
  format: number,
  bits: number
): number => {
  let value: number;
  if (format === 3) {
    value = view.getFloat32(at, true);
  } else if (bits === 8) {
    value = (view.getUint8(at) - 128) / 128;
  } else if (bits === 16) {
    value = view.getInt16(at, true) / 32_768;
  } else if (bits === 24) {
    let integer =
      view.getUint8(at) +
      view.getUint8(at + 1) * 256 +
      view.getUint8(at + 2) * 65_536;
    if (integer >= 8_388_608) {
      integer -= 16_777_216;
    }
    value = integer / 0x80_00_00;
  } else {
    value = view.getInt32(at, true) / 0x80_00_00_00;
  }

  return Number.isFinite(value) ? value : 0;
};
const supportedFormat = (format: number, bits: number) =>
  format !== 3 || bits === 32;
export const decodePcmWave = (bytes: Uint8Array<ArrayBuffer>): PcmWave => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44 || tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") {
    throw new Error("対応するWAVファイルではありません。");
  }
  let format = 0;
  let rate = 0;
  let count = 0;
  let bits = 0;
  let dataAt = 0;
  let dataSize = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);
    if (at + 8 + size > bytes.length) {
      throw new Error("WAVのチャンクが途中で切れています。");
    }
    if (tag(view, at) === "fmt " && size >= 16) {
      format = view.getUint16(at + 8, true);
      count = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
      format =
        format === 65_534 && size >= 40
          ? view.getUint16(at + 32, true)
          : format;
    } else if (tag(view, at) === "data") {
      dataAt = at + 8;
      dataSize = size;
    }
    at += 8 + size + (size % 2);
  }
  if (
    !count ||
    !rate ||
    !dataAt ||
    ![8, 16, 24, 32].includes(bits) ||
    ![1, 3].includes(format) ||
    !supportedFormat(format, bits)
  ) {
    throw new Error(
      "加工は8/16/24/32bit PCMと32bit浮動小数点WAVに対応しています。"
    );
  }
  const stride = bits / 8;
  const length = Math.floor(dataSize / (count * stride));
  const channels = Array.from(
    { length: count },
    () => new Float32Array(length)
  );
  for (let frame = 0; frame < length; frame += 1) {
    for (const [channel, samples] of channels.entries()) {
      const at = dataAt + (frame * count + channel) * stride;
      samples[frame] = readSample(view, at, format, bits);
    }
  }
  return { rate, channels, bits, floating: format === 3 };
};
export const encodePcmWave = (wave: PcmWave): Uint8Array<ArrayBuffer> => {
  const count = wave.channels.length;
  const length = wave.channels[0]?.length ?? 0;
  const stride = wave.bits / 8;
  const dataSize = length * count * stride;
  const bytes = new Uint8Array(44 + dataSize + (dataSize % 2));
  const view = new DataView(bytes.buffer);
  const writeTag = (at: number, text: string) => {
    for (let i = 0; i < 4; i += 1) {
      view.setUint8(at + i, text.codePointAt(i) ?? 0);
    }
  };
  writeTag(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, wave.floating ? 3 : 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, wave.rate, true);
  view.setUint32(28, wave.rate * count * stride, true);
  view.setUint16(32, count * stride, true);
  view.setUint16(34, wave.bits, true);
  writeTag(36, "data");
  view.setUint32(40, dataSize, true);
  for (let frame = 0; frame < length; frame += 1) {
    for (const [channel, samples] of wave.channels.entries()) {
      const at = 44 + (frame * count + channel) * stride;
      const value = Math.max(-1, Math.min(1, samples[frame] ?? 0));
      if (wave.floating) {
        view.setFloat32(at, value, true);
      } else if (wave.bits === 8) {
        view.setUint8(at, Math.min(255, Math.round(value * 128 + 128)));
      } else if (wave.bits === 16) {
        view.setInt16(at, Math.min(32_767, Math.round(value * 32_768)), true);
      } else if (wave.bits === 24) {
        const integer = Math.min(0x7f_ff_ff, Math.round(value * 0x80_00_00));
        view.setUint8(at, integer % 256);
        view.setUint8(at + 1, Math.floor(integer / 256) % 256);
        view.setUint8(at + 2, Math.floor(integer / 65_536) % 256);
      } else {
        view.setInt32(
          at,
          Math.min(0x7f_ff_ff_ff, Math.round(value * 0x80_00_00_00)),
          true
        );
      }
    }
  }
  return bytes;
};
export const processWave = (
  wave: PcmWave,
  options: { dc: boolean; mono: boolean; headMs: number; tailMs: number }
): PcmWave => {
  const length = wave.channels[0]?.length ?? 0;
  const head = Math.round((options.headMs * wave.rate) / 1000);
  const tail = Math.round((options.tailMs * wave.rate) / 1000);
  if (head < 0 || tail < 0 || head + tail >= length) {
    throw new Error("カット後に音声が残る長さを指定してください。");
  }
  let channels = wave.channels.map((samples) => {
    const result = samples.slice(head, length - tail);
    if (options.dc) {
      let previousInput = 0;
      let previousOutput = 0;
      for (let i = 0; i < result.length; i += 1) {
        const input = result[i] ?? 0;
        const output = 0.99 * (input - previousInput + previousOutput);
        result[i] = output;
        previousInput = input;
        previousOutput = output;
      }
    }
    return result;
  });
  if (options.mono && channels.length > 1) {
    const mixed = new Float32Array(length - head - tail);
    for (const samples of channels) {
      for (let i = 0; i < samples.length; i += 1) {
        mixed[i] = (mixed[i] ?? 0) + (samples[i] ?? 0) / channels.length;
      }
    }
    channels = [mixed];
  }
  return { ...wave, channels };
};
/** 両端カットでは左右ブランクのみ補正し、相対値は保持する。 */
export const adjustTrimBlanks = (oto: Oto, head: number, tail: number): Oto =>
  withParams(oto, {
    offset: Math.max(0, oto.offset - head),
    cutoff: oto.cutoff < 0 ? oto.cutoff : Math.max(0, oto.cutoff - tail),
  });

export const trimOto = (
  oto: Oto,
  duration: number,
  head: number,
  tail: number
): Oto => {
  if (head === 0 && tail === 0) {
    return oto;
  }
  const nextDuration = duration - head - tail;
  const clamp = (ms: number) => Math.max(0, Math.min(nextDuration, ms - head));
  const offset = clamp(oto.offset);
  const end = Math.max(offset, clamp(cutoffEnd(oto, duration)));
  return withParams(oto, {
    offset,
    cutoff: oto.cutoff < 0 ? -(end - offset) : nextDuration - end,
    overlap: clamp(oto.offset + oto.overlap) - offset,
    preutter: clamp(oto.offset + oto.preutter) - offset,
    consonant: clamp(oto.offset + oto.consonant) - offset,
  });
};
