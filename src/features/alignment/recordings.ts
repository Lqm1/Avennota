import { z } from "zod";

import {
  moraeFromPhones,
  parseMorae,
  transcriptionFromFilename,
} from "./japanese";
import type { Mora } from "./japanese";

export interface RecordingTranscript {
  wav: string;
  morae: Mora[];
}

/** SHIRO index形式: 拡張子なしのWAV名,空白区切り音素列。 */
export const readRecordingIndex = (text: string): Map<string, string[]> => {
  const recordings = new Map<string, string[]>();
  for (const [index, row] of text.split(/\r\n|\r|\n/u).entries()) {
    if (row.trim() === "") {
      continue;
    }
    const comma = row.indexOf(",");
    if (comma < 1) {
      throw new Error(
        `index.csvの${index + 1}行目は「WAV名,音素列」ではありません。`
      );
    }
    const stem = row
      .slice(0, comma)
      .trim()
      .replace(/\.wav$/iu, "");
    const phones = row
      .slice(comma + 1)
      .trim()
      .split(/\s+/u);
    if (
      stem.includes("/") ||
      stem.includes("\\") ||
      phones.some((phone) => phone === "" || phone.includes(","))
    ) {
      throw new Error(
        `index.csvの${index + 1}行目に不正なWAV名または音素列があります。`
      );
    }
    const key = `${stem}.wav`.toLocaleLowerCase("ja");
    if (recordings.has(key)) {
      throw new Error(`index.csvで「${stem}」が重複しています。`);
    }
    recordings.set(key, phones);
  }
  return recordings;
};

const phoneArraySchema = z.array(z.string().min(1)).min(1);

/** 仮名名からの一致候補を使い、曖昧な音素列からエイリアスを捏造しない。 */
export const recordingTranscript = (
  wav: string,
  transcription: string | undefined,
  indexPhones?: string[]
): RecordingTranscript => {
  if (transcription === undefined) {
    return { wav, morae: moraeFromPhones(phoneArraySchema.parse(indexPhones)) };
  }
  const morae = parseMorae(transcription);
  if (indexPhones === undefined) {
    return { wav, morae };
  }
  const phones = phoneArraySchema.parse(indexPhones);
  let at = 0;
  const indexed = morae.map((mora) => {
    const expected = mora.phones;
    const actual = phones.slice(at, at + expected.length);
    at += expected.length;
    if (
      actual.length !== expected.length ||
      actual.some((phone, i) => {
        const expectedPhone = expected[i];
        return (
          phone !== expectedPhone &&
          !(
            expectedPhone !== undefined &&
            "aiueo".includes(expectedPhone) &&
            phone.toLowerCase() === expectedPhone
          )
        );
      })
    ) {
      throw new Error(
        `「${wav}」の仮名とindex.csvの音素列が一致しません。発音列を修正してください。`
      );
    }
    return { kana: mora.kana, phones: actual };
  });
  if (at !== phones.length) {
    throw new Error(`「${wav}」の仮名とindex.csvの音素数が一致しません。`);
  }
  return { wav, morae: indexed };
};

export const filenameTranscript = (
  wav: string,
  suffix: string
): RecordingTranscript =>
  recordingTranscript(wav, transcriptionFromFilename(wav, suffix));
