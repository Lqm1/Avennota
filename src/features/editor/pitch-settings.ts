import type { AdvancedSettings } from "./advanced-settings";

export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;
export const noteFrequency = (note: number): number =>
  440 * 2 ** ((note - 69) / 12);
export const frequencyNote = (hz: number): number =>
  Math.round(69 + 12 * Math.log2(hz / 440));

/** ターゲット音から解析範囲と上下2半音の表示範囲を設定する。 */
export const pitchTargetPreset = (
  settings: AdvancedSettings
): AdvancedSettings => {
  const target = settings.targetPitch;
  const note = frequencyNote(target);
  return {
    ...settings,
    pitchMax: Math.min(4000, Math.floor(target * 2.1)),
    pitchMin: target >= 260 ? Math.floor(target / 2.2) : 60,
    pitchFixedRange: true,
    pitchDisplayMin: noteFrequency(note - 2),
    pitchDisplayMax: noteFrequency(note + 2),
  };
};
