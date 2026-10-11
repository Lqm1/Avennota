import { z } from "zod";

import type { LineSource, OtoLine, OtoSet } from "../oto/oto-set";
import { createLineId, parseLine } from "../oto/oto-set";
import { folderBookmarkSchema } from "./folder-bookmark";

const eolSchema = z.enum(["\r\n", "\n", "\r", ""]);
const sourceSchema = z.object({
  text: z.string(),
  raw: z.base64(),
  eol: eolSchema,
});
type StoredSource = Omit<LineSource, "raw"> & { raw: string };
type StoredLine = Pick<OtoLine, "text" | "comment"> & {
  source: StoredSource | null;
};

const storedLineSchema = z.object({
  text: z.string(),
  comment: z.string().optional(),
  source: sourceSchema.nullable(),
});

export type StoredOtoSet = Omit<OtoSet, "bom" | "lines"> & {
  bom: string;
  lines: StoredLine[];
};

export const storedOtoSetSchema = z.object({
  encoding: z.enum(["utf-8", "shift_jis"]),
  encodingCertainty: z.enum(["bom", "valid", "ambiguous", "invalid"]),
  bom: z.base64(),
  eol: z.enum(["\r\n", "\n", "\r"]),
  trailingEol: z.boolean(),
  lines: z.array(storedLineSchema),
}) satisfies z.ZodType<StoredOtoSet>;

export const recoveryDataSchema = z.object({
  otoName: z.string().min(1),
  baselineHash: z.string().nullable(),
  storageBookmark: folderBookmarkSchema.optional(),
  otoSet: storedOtoSetSchema,
});
export type RecoveryData = z.output<typeof recoveryDataSchema>;

export const recoveryRecordSchema = z.object({
  id: z.string().min(1),
  folderName: z.string(),
  savedAt: z.number(),
  data: recoveryDataSchema,
});
export type RecoveryRecord = z.output<typeof recoveryRecordSchema>;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
};
const fromBase64 = (text: string): LineSource["raw"] =>
  Uint8Array.from(atob(text), (char) => char.codePointAt(0) ?? 0);

export const serializeOtoSetForRecovery = (otoSet: OtoSet): StoredOtoSet => ({
  ...otoSet,
  bom: toBase64(otoSet.bom),
  lines: otoSet.lines.map(({ text, source, comment }) => ({
    text,
    comment,
    source: source === null ? null : { ...source, raw: toBase64(source.raw) },
  })),
});

export const deserializeOtoSet = (stored: StoredOtoSet): OtoSet => ({
  ...stored,
  bom: fromBase64(stored.bom),
  lines: stored.lines.map(({ text, source, comment }): OtoLine => ({
    comment,
    id: createLineId(),
    text,
    parsed: parseLine(text),
    source: source === null ? null : { ...source, raw: fromBase64(source.raw) },
  })),
});
