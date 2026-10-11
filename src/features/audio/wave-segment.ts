/* eslint-disable no-await-in-loop -- Each RIFF chunk offset depends on the previous header. */
import type { VoiceFolder } from "../../platform/files";
import type { EditorSettings } from "../editor/settings";
import { toPositions } from "../oto/geometry";
import type { OtoParams } from "../oto/oto-set";
import { loadWavBlob } from "./wav-cache";

export interface WaveSegment {
  blob: Blob;
  offsetMs: number;
  durationMs: number | null;
}
const textAt = (bytes: Uint8Array, at: number) =>
  String.fromCodePoint(...bytes.subarray(at, at + 4));
const readWaveHeader = async (
  read: (offset: number, length: number) => Promise<Uint8Array<ArrayBuffer>>,
  size: number
) => {
  const head = await read(0, 12);
  if (textAt(head, 0) !== "RIFF" || textAt(head, 8) !== "WAVE") {
    throw new Error("部分読み込みはPCM WAVに対応しています。");
  }

  let fmt: Uint8Array<ArrayBuffer> | null = null;
  let dataAt = 0;
  let dataSize = 0;
  for (let at = 12; at + 8 <= size;) {
    const header = await read(at, 8);
    if (header.length !== 8) {
      throw new Error("WAVヘッダーが途中で切れています。");
    }
    const chunkSize = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength
    ).getUint32(4, true);
    if (at + 8 + chunkSize > size) {
      throw new Error("WAVのチャンクが途中で切れています。");
    }
    if (textAt(header, 0) === "fmt ") {
      if (chunkSize > 4096) {
        throw new Error("WAVの形式情報が不正です。");
      }
      fmt = await read(at + 8, chunkSize);
    }
    if (textAt(header, 0) === "data") {
      dataAt = at + 8;
      dataSize = chunkSize;
      break;
    }
    at += 8 + chunkSize + (chunkSize % 2);
  }
  if (fmt === null || fmt.length < 16 || dataAt === 0) {
    throw new Error("WAVの音声情報がありません。");
  }
  const view = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength);
  const encodedFormat = view.getUint16(0, true);
  const format =
    encodedFormat === 65_534 && fmt.length >= 40
      ? view.getUint16(24, true)
      : encodedFormat;
  const rate = view.getUint32(4, true);
  const align = view.getUint16(12, true);
  if (![1, 3].includes(format) || rate === 0 || align === 0) {
    throw new Error("部分読み込みはPCM WAVに対応しています。");
  }
  const totalFrames = Math.floor(dataSize / align);
  if (totalFrames < 1) {
    throw new Error("WAVに音声がありません。");
  }
  const durationMs = (totalFrames / rate) * 1000;

  return { head, fmt, dataAt, rate, align, totalFrames, durationMs };
};
export const loadWaveSegment = async (
  folder: VoiceFolder,
  wav: string,
  params: OtoParams,
  settings: EditorSettings
): Promise<WaveSegment> => {
  if (!settings.advanced.partialRead || settings.autoFocus === "none") {
    return {
      blob: await loadWavBlob(folder, wav),
      offsetMs: 0,
      durationMs: null,
    };
  }
  const whole = folder.readRange === undefined ? await folder.read(wav) : null;
  const read = async (offset: number, length: number) =>
    folder.readRange === undefined
      ? (whole?.slice(offset, offset + length) ?? new Uint8Array())
      : await folder.readRange(wav, offset, length);
  const info = await folder.stat(wav);
  const { head, fmt, dataAt, rate, align, totalFrames, durationMs } =
    await readWaveHeader(read, info?.size ?? 0);
  const center = toPositions(params, durationMs)[settings.autoFocus];
  const span = settings.advanced.partialBefore + settings.advanced.partialAfter;
  const startMs = Math.max(
    0,
    Math.min(durationMs - span, center - settings.advanced.partialBefore)
  );
  const start = Math.min(totalFrames - 1, Math.floor((startMs * rate) / 1000));
  const end = Math.max(
    start + 1,
    Math.min(totalFrames, Math.ceil(((startMs + span) * rate) / 1000))
  );
  const data = await read(dataAt + start * align, (end - start) * align);
  if (data.length !== (end - start) * align) {
    throw new Error("WAVの音声が途中で切れています。");
  }
  const fmtPadding = fmt.length % 2;
  const result = new Uint8Array(
    12 + 8 + fmt.length + fmtPadding + 8 + data.length + (data.length % 2)
  );
  result.set(head);
  const output = new DataView(result.buffer);
  output.setUint32(4, result.length - 8, true);
  result.set(new TextEncoder().encode("fmt "), 12);
  output.setUint32(16, fmt.length, true);
  result.set(fmt, 20);
  const at = 20 + fmt.length + fmtPadding;
  result.set(new TextEncoder().encode("data"), at);
  output.setUint32(at + 4, data.length, true);
  result.set(data, at + 8);
  return {
    blob: new Blob([result], { type: "audio/wav" }),
    offsetMs: (start / rate) * 1000,
    durationMs,
  };
};
