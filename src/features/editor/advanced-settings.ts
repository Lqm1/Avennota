import { z } from "zod";

export const WINDOWS = [
  "hamming",
  "hann",
  "bartlett",
  "blackman",
  "rectangular",
] as const;
const colorSchema = z.string().regex(/^#[\da-f]{6}$/iu);
const colorsSchema = z.object({
  wave: colorSchema.default("#94a3b8"),
  power: colorSchema.default("#38bdf8"),
  pitch: colorSchema.default("#fbbf24"),
  offset: colorSchema.default("#94a3b8"),
  overlap: colorSchema.default("#4ade80"),
  preutter: colorSchema.default("#f87171"),
  consonant: colorSchema.default("#60a5fa"),
  cutoff: colorSchema.default("#94a3b8"),
  grid: colorSchema.default("#475569"),
  target: colorSchema.default("#fb7185"),
});
export const advancedSettingsFieldsSchema = z.object({
  allowTrim: z.boolean().default(false),
  showPower: z.boolean().default(false),
  showPitch: z.boolean().default(false),
  powerHeight: z.number().int().min(50).max(2000).default(100),
  pitchHeight: z.number().int().min(50).max(2000).default(140),
  sampleRate: z.number().int().min(8000).max(192_000).default(44_100),
  brightness: z.number().min(-100).max(100).default(0),
  contrast: z.number().min(-100).max(100).default(0),
  windowLength: z.number().int().min(8).max(4096).default(512),
  window: z.enum(WINDOWS).default("hamming"),
  preEmphasis: z.number().min(0).max(1).default(0.97),
  powerStep: z.number().positive().max(1000).default(20),
  powerWindow: z.number().positive().max(1000).default(10),
  powerPreEmphasis: z.number().min(0).max(1).default(0.97),
  powerWindowKind: z.enum(WINDOWS).default("hann"),
  pitchStep: z.number().positive().max(1000).default(10),
  pitchWindow: z.number().positive().max(1000).default(10),
  pitchMin: z.number().min(20).max(4000).default(60),
  pitchMax: z.number().min(20).max(4000).default(800),
  pitchMethod: z.enum(["mpm", "amdf"]).default("mpm"),
  pitchUnit: z.enum(["hz", "semitone"]).default("semitone"),
  pitchFixedRange: z.boolean().default(false),
  pitchDisplayMin: z.number().min(20).max(8000).default(65.40639132514966),
  pitchDisplayMax: z.number().min(20).max(8000).default(523.2511306011972),
  toneGrid: z.boolean().default(false),
  targetPitch: z.number().min(20).max(8000).default(65.40639132514966),
  showTargetPitch: z.boolean().default(false),
  partialRead: z.boolean().default(false),
  partialBefore: z.number().min(0).max(600_000).default(15_000),
  partialAfter: z.number().positive().max(600_000).default(15_000),
  fontFamily: z.string().min(1).max(200).default("system-ui"),
  fontSize: z.number().min(10).max(28).default(12),
  colors: colorsSchema.default(() => colorsSchema.parse({})),
  autoSaveSettings: z.boolean().default(true),
  clipboardFormat: z.enum(["csv", "tsv"]).default("csv"),
  alwaysOnTop: z.boolean().default(false),
  opacity: z.number().min(0.2).max(1).default(1),
});
export const advancedSettingsSchema = advancedSettingsFieldsSchema
  .refine((settings) => settings.pitchMax < settings.sampleRate / 2, {
    message: "F0抽出上限はサンプリング周波数の半分未満にしてください。",
    path: ["pitchMax"],
  })
  .refine((settings) => settings.pitchMin < settings.pitchMax, {
    message: "F0抽出下限は上限より小さくしてください。",
    path: ["pitchMin"],
  })
  .refine((settings) => settings.pitchDisplayMin < settings.pitchDisplayMax, {
    message: "F0表示下限は上限より小さくしてください。",
    path: ["pitchDisplayMin"],
  });
export type AdvancedSettings = z.output<typeof advancedSettingsSchema>;
export const DEFAULT_ADVANCED = advancedSettingsSchema.parse({});
