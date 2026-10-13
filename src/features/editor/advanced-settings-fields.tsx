import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import {
  CommitTextField,
  MsField,
  SelectField,
} from "../../components/ui/field";
import { advancedSettingsSchema, WINDOWS } from "./advanced-settings";
import type { AdvancedSettings } from "./advanced-settings";
import { PitchField } from "./pitch-field";
import { pitchTargetPreset } from "./pitch-settings";
import type { EditorSettings } from "./settings";
import { notify } from "./store";

const colorLabels: Record<keyof AdvancedSettings["colors"], string> = {
  wave: "波形",
  power: "パワー",
  pitch: "F0",
  offset: "左ブランク",
  overlap: "オーバーラップ",
  preutter: "先行発声",
  consonant: "固定範囲",
  cutoff: "右ブランク",
  grid: "音高目盛",
  target: "目標音高",
};
const colorKeys = [
  "wave",
  "power",
  "pitch",
  "offset",
  "overlap",
  "preutter",
  "consonant",
  "cutoff",
  "grid",
  "target",
] as const;
const windowLabels = {
  hamming: "ハミング",
  hann: "ハン",
  bartlett: "バートレット",
  blackman: "ブラックマン",
  rectangular: "矩形",
};
const secondsFields = new Set<keyof AdvancedSettings>([
  "powerStep",
  "powerWindow",
  "pitchStep",
  "pitchWindow",
]);
const numericFields: { key: keyof AdvancedSettings; label: string }[] = [
  { key: "sampleRate", label: "解析サンプリング周波数（Hz）" },
  { key: "brightness", label: "スペクトログラムの明るさ（−100〜100）" },
  { key: "contrast", label: "コントラスト（−100〜100）" },
  { key: "windowLength", label: "スペクトログラム窓長（サンプル）" },
  { key: "preEmphasis", label: "プリエンファシス（0〜1）" },
  { key: "powerHeight", label: "パワーの高さ比率" },
  { key: "powerStep", label: "パワー抽出間隔（秒）" },
  { key: "powerWindow", label: "パワー窓長（秒）" },
  { key: "powerPreEmphasis", label: "パワーのプリエンファシス（0〜1）" },
  { key: "pitchHeight", label: "ピッチ（F0）の高さ比率" },
  { key: "pitchStep", label: "F0抽出間隔（秒）" },
  { key: "pitchWindow", label: "F0窓長（秒）" },
  { key: "pitchMin", label: "解析下限ピッチ（Hz）" },
  { key: "pitchMax", label: "解析上限ピッチ（Hz）" },
  { key: "fontSize", label: "文字サイズ（px）" },
];
export const AdvancedSettingsFields = ({
  draft,
  onChange,
}: {
  draft: EditorSettings;
  onChange: (draft: EditorSettings) => void;
}) => {
  const { advanced } = draft;
  const change = (patch: Partial<AdvancedSettings>) => {
    const parsed = advancedSettingsSchema.safeParse({ ...advanced, ...patch });
    if (parsed.success && parsed.data.windowLength <= draft.fftSamples) {
      onChange({ ...draft, advanced: parsed.data });
    } else {
      notify("warning", "設定値が範囲外です。窓長はFFT長以下にしてください。");
    }
  };
  return (
    <>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-xs font-semibold text-slate-400">
          詳細表示・解析
        </legend>
        <Check
          label="ピッチ表示範囲を固定"
          value={advanced.pitchFixedRange}
          onChange={(pitchFixedRange) => {
            change({ pitchFixedRange });
          }}
        />
        <Check
          label="音高グリッド線を表示"
          value={advanced.toneGrid}
          onChange={(toneGrid) => {
            change({ toneGrid });
          }}
        />
        <Check
          label="目標音高のガイド線を表示"
          value={advanced.showTargetPitch}
          onChange={(showTargetPitch) => {
            change({ showTargetPitch });
          }}
        />
        <SelectField
          label="ピッチ抽出アルゴリズム"
          value={advanced.pitchMethod}
          options={[
            { id: "mpm", label: "MPM" },
            { id: "amdf", label: "AMDF" },
          ]}
          onChange={(pitchMethod) => {
            change({ pitchMethod });
          }}
        />
        <SelectField
          label="ピッチ表示単位"
          value={advanced.pitchUnit}
          options={[
            { id: "hz", label: "Hz" },
            { id: "semitone", label: "音名・半音" },
          ]}
          onChange={(pitchUnit) => {
            change({ pitchUnit });
          }}
        />
        <SelectField
          label="スペクトログラム窓関数"
          value={advanced.window}
          options={WINDOWS.map((id) => ({ id, label: windowLabels[id] }))}
          onChange={(window) => {
            change({ window });
          }}
        />
        <SelectField
          label="パワー窓関数"
          value={advanced.powerWindowKind}
          options={WINDOWS.map((id) => ({ id, label: windowLabels[id] }))}
          onChange={(powerWindowKind) => {
            change({ powerWindowKind });
          }}
        />
        <PitchField
          label="ピッチ表示下限"
          value={advanced.pitchDisplayMin}
          onChange={(pitchDisplayMin) => {
            change({ pitchDisplayMin });
          }}
        />
        <PitchField
          label="ピッチ表示上限"
          value={advanced.pitchDisplayMax}
          onChange={(pitchDisplayMax) => {
            change({ pitchDisplayMax });
          }}
        />
        <PitchField
          label="目標音高"
          value={advanced.targetPitch}
          onChange={(targetPitch) => {
            change({ targetPitch });
          }}
        />
        <Button
          onPress={() => {
            change(pitchTargetPreset(advanced));
          }}
        >
          目標音高に合わせて表示範囲を自動調整
        </Button>
        <div className="grid grid-cols-2 gap-2">
          {numericFields.map(({ key, label }) => {
            const value = advanced[key];
            return typeof value === "number" ? (
              <MsField
                key={key}
                label={label}
                value={secondsFields.has(key) ? value / 1000 : value}
                swatch={null}
                onCommit={(number) => {
                  change({
                    [key]: secondsFields.has(key) ? number * 1000 : number,
                  });
                }}
              />
            ) : null;
          })}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-xs font-semibold text-slate-400">
          色・文字
        </legend>
        <CommitTextField
          label="フォント"
          value={advanced.fontFamily}
          onCommit={(fontFamily) => {
            change({ fontFamily });
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          {colorKeys.map((key) => (
            <label
              key={key}
              className="flex items-center justify-between text-xs text-slate-300"
            >
              <span>{colorLabels[key]}</span>
              <input
                type="color"
                aria-label={`${colorLabels[key]}の色`}
                value={advanced.colors[key]}
                onChange={(event) => {
                  change({
                    colors: { ...advanced.colors, [key]: event.target.value },
                  });
                }}
              />
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
};
