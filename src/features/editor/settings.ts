import { createCollection, localStorageCollectionOptions } from "@tanstack/db";
import { createStore, useSelector } from "@tanstack/react-store";
import { z } from "zod";

import { MARKERS } from "../oto/geometry";
import { advancedSettingsSchema, DEFAULT_ADVANCED } from "./advanced-settings";

export const PLAY_POINTS = ["head", ...MARKERS, "tail"] as const;
export type PlayPoint = (typeof PLAY_POINTS)[number];
const pointSchema = z.enum(PLAY_POINTS);
export const FFT_SIZES = [
  8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096,
] as const;
const flags = z.object({
  offset: z.boolean(),
  overlap: z.boolean(),
  preutter: z.boolean(),
  consonant: z.boolean(),
  cutoff: z.boolean(),
});
export const settingsSchema = z.object({
  advanced: advancedSettingsSchema.default(DEFAULT_ADVANCED),
  clickMode: z.enum(["none", "range", "timing"]),
  offsetMode: z.enum(["positions", "relative"]),
  preutterMode: z.enum(["independent", "relative"]),
  negativeOverlap: z.boolean(),
  blankBroom: z.boolean(),
  cutoffMode: z.enum(["positive", "negative"]),
  autoNext: flags,
  autoFocus: z.enum(["none", ...MARKERS]),
  followPlayMark: z.boolean(),
  returnToPlayStart: z.boolean(),
  showWhole: z.boolean(),
  showWave: z.boolean(),
  showSpec: z.boolean(),
  waveHeight: z.number().min(50).max(2000),
  specHeight: z.number().min(50).max(2000),
  waveScale: z.number().min(0).max(32_768),
  timeUnit: z.enum(["seconds", "bars"]),
  bpm: z.number().positive().max(1000),
  bpmOffset: z.number(),
  fftSamples: z.literal(FFT_SIZES),
  frequencyMax: z.number().positive().max(96_000),
  spectrumColor: z.enum(["gray", "roseus", "igray", "color1", "color2"]),
  playRanges: z
    .array(z.object({ start: pointSchema, end: pointSchema }))
    .length(5),
  timing: z.object({
    tempo: z.number().int().positive().max(1000),
    preCount: z.number().int().min(0).max(20),
    mix: z.number().min(0).max(1),
  }),
});
export type EditorSettings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: EditorSettings = {
  advanced: DEFAULT_ADVANCED,
  clickMode: "none",
  offsetMode: "positions",
  preutterMode: "independent",
  negativeOverlap: false,
  blankBroom: true,
  cutoffMode: "positive",
  autoNext: {
    offset: false,
    overlap: false,
    preutter: false,
    consonant: false,
    cutoff: false,
  },
  autoFocus: "preutter",
  followPlayMark: false,
  returnToPlayStart: false,
  showWhole: true,
  showWave: true,
  showSpec: false,
  waveHeight: 100,
  specHeight: 140,
  waveScale: 32_768,
  timeUnit: "seconds",
  bpm: 120,
  bpmOffset: 0,
  fftSamples: 512,
  frequencyMax: 8000,
  spectrumColor: "gray",
  playRanges: [
    { start: "head", end: "offset" },
    { start: "offset", end: "overlap" },
    { start: "offset", end: "preutter" },
    { start: "offset", end: "consonant" },
    { start: "offset", end: "cutoff" },
  ],
  timing: { tempo: 100, preCount: 3, mix: 0.5 },
};
const STORAGE_KEY = "avennota.editor-settings";
const savedSettingsSchema = z.object({
  id: z.literal("settings"),
  value: settingsSchema,
});
const PERSIST_ERROR = "設定を保存できません。この起動中だけ適用します。";
export const settingsErrorStore = createStore("");
const openSettings = () => {
  try {
    return createCollection(
      localStorageCollectionOptions({
        id: "editor-settings",
        storageKey: STORAGE_KEY,
        schema: savedSettingsSchema,
        getKey: (row) => row.id,
        startSync: true,
        gcTime: Infinity,
      })
    );
  } catch {
    settingsErrorStore.setState(() => PERSIST_ERROR);
    return null;
  }
};
const savedSettings = openSettings();
const loadedSettings = settingsSchema.safeParse(
  savedSettings?.get("settings")?.value
);
export const settingsStore = createStore(
  loadedSettings.success
    ? loadedSettings.data
    : structuredClone(DEFAULT_SETTINGS)
);
export const useSettings = () => useSelector(settingsStore, (state) => state);
const saveSettings = async (value: EditorSettings): Promise<void> => {
  if (savedSettings === null) {
    return;
  }
  try {
    const transaction = savedSettings.has("settings")
      ? savedSettings.update("settings", (row) => {
          row.value = value;
        })
      : savedSettings.insert({ id: "settings", value });
    await transaction.when("settled");
    settingsErrorStore.setState(() => "");
  } catch {
    // セッション中の設定は維持する。永続化の失敗は設定画面で表示する。
    settingsErrorStore.setState(() => PERSIST_ERROR);
  }
};
let saving = Promise.resolve();
export const persistSettings = async (): Promise<void> => {
  const previous = saving;
  const value = settingsSchema.parse(settingsStore.state);
  const save = async (): Promise<void> => {
    await previous;
    await saveSettings(value);
  };
  saving = save();
  await saving;
};
export const updateSettings = (changes: Partial<EditorSettings>): void => {
  const next = settingsSchema.parse({ ...settingsStore.state, ...changes });
  settingsStore.setState(() => next);
  if (!next.advanced.autoSaveSettings) {
    return;
  }
  void persistSettings();
};
export type EditorPanel =
  | "settings"
  | "bulk"
  | "alias"
  | "query"
  | "aliasRules"
  | "duplicates"
  | "parameters"
  | "conversion"
  | "fileOpen"
  | "fileSave"
  | "tools"
  | "alignment"
  | "wavCut"
  | "timingSettings"
  | "playRangeSettings"
  | "focusSettings"
  | "nextSettings"
  | "bpm"
  | "opacity"
  | "recentFolders"
  | null;
export const editorPanelStore = createStore<EditorPanel>(null);
export const showEditorPanel = (panel: EditorPanel): void => {
  editorPanelStore.setState(() => panel);
};
export const closeEditorPanel = (): void => {
  showEditorPanel(null);
};
