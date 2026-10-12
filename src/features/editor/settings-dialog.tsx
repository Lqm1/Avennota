import { useSelector } from "@tanstack/react-store";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { MsField, SelectField } from "../../components/ui/field";
import { setTimingClick, resetTimingClick } from "../audio/timing-player";
import { stopTone } from "../audio/tone-player";
import { MARKERS, MARKER_LABELS } from "../oto/geometry";
import { AdvancedSettingsFields } from "./advanced-settings-fields";
import { applyEditorSettings } from "./apply-settings";
import { InputSettingsFields } from "./input-settings-fields";
import {
  DEFAULT_SETTINGS,
  FFT_SIZES,
  PLAY_POINTS,
  settingsErrorStore,
  showEditorPanel,
  useSettings,
} from "./settings";
import type { EditorSettings, PlayPoint } from "./settings";

const pointLabels: Record<PlayPoint, string> = {
  head: "ファイル先頭",
  tail: "ファイル末尾",
  ...MARKER_LABELS,
};
const pointOptions = PLAY_POINTS.map((id) => ({ id, label: pointLabels[id] }));
const close = () => {
  stopTone();
  showEditorPanel(null);
};
export const SETTINGS_SECTIONS = {
  inputSettings: "マウス・キー操作",
  settings: "詳細設定",
  timingSettings: "発声タイミングチェックの設定",
  playRangeSettings: "指定範囲再生の設定",
  focusSettings: "パラメータへの自動フォーカス設定",
  nextSettings: "原音設定したら次のエントリに自動で移動する設定",
};
export type SettingsSection = keyof typeof SETTINGS_SECTIONS;
export const SettingsForm = ({
  mode,
  onClose,
  liveUpdates = true,
}: {
  mode: SettingsSection;
  onClose: () => void;
  liveUpdates?: boolean;
}) => {
  const current = useSettings();
  const settingsPersistenceError = useSelector(
    settingsErrorStore,
    (state) => state
  );
  const [draft, setDraft] = useState<EditorSettings>(() =>
    structuredClone(current)
  );
  const [clickFile, setClickFile] = useState<File | "default" | null>(null);
  const live =
    liveUpdates &&
    ["focusSettings", "nextSettings", "playRangeSettings"].includes(mode);
  const change = (values: Partial<EditorSettings>) => {
    const next = { ...draft, ...values };
    setDraft(next);
    if (live) {
      void applyEditorSettings(next);
    }
  };
  const apply = async () => {
    if (clickFile === "default" && !(await resetTimingClick())) {
      return false;
    }
    if (clickFile instanceof File && !(await setTimingClick(clickFile))) {
      return false;
    }
    setClickFile(null);
    return await applyEditorSettings(draft);
  };
  const applyAndClose = async () => {
    if (await apply()) {
      onClose();
    }
  };
  return (
    <div className="flex flex-col gap-5">
      {mode === "inputSettings" ? (
        <InputSettingsFields draft={draft} onChange={change} />
      ) : null}
      {mode === "focusSettings" || mode === "nextSettings" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-xs font-semibold text-slate-400">
            {SETTINGS_SECTIONS[mode]}
          </legend>
          {mode === "focusSettings" ? (
            <>
              <SelectField
                label="パラメータへの自動フォーカス設定"
                value={draft.autoFocus}
                options={[
                  { id: "none", label: "フォーカスしない" },
                  ...MARKERS.map((id) => ({ id, label: MARKER_LABELS[id] })),
                ]}
                onChange={(autoFocus) => {
                  change({
                    autoFocus,
                    advanced: {
                      ...draft.advanced,
                      partialRead:
                        autoFocus === "none"
                          ? false
                          : draft.advanced.partialRead,
                    },
                  });
                }}
              />
              <Check
                label="フォーカス位置の周囲のみを表示する(長尺のwav処理が高速になる)"
                value={draft.advanced.partialRead}
                disabled={draft.autoFocus === "none"}
                onChange={(partialRead) => {
                  const halfRange =
                    (draft.advanced.partialBefore +
                      draft.advanced.partialAfter) /
                    2;
                  change({
                    advanced: {
                      ...draft.advanced,
                      partialRead,
                      partialBefore: partialRead
                        ? halfRange
                        : draft.advanced.partialBefore,
                      partialAfter: partialRead
                        ? halfRange
                        : draft.advanced.partialAfter,
                    },
                  });
                }}
              />
              <MsField
                label="表示範囲（秒）"
                value={
                  (draft.advanced.partialBefore + draft.advanced.partialAfter) /
                  1000
                }
                swatch={null}
                onCommit={(seconds) => {
                  if (seconds > 0 && seconds <= 1200) {
                    change({
                      advanced: {
                        ...draft.advanced,
                        partialBefore: seconds * 500,
                        partialAfter: seconds * 500,
                      },
                    });
                  }
                }}
              />
            </>
          ) : null}
          {mode === "nextSettings" ? (
            <div className="grid grid-cols-2 gap-2">
              {MARKERS.map((marker) => (
                <Check
                  key={marker}
                  label={MARKER_LABELS[marker]}
                  value={draft.autoNext[marker]}
                  onChange={(on) => {
                    change({ autoNext: { ...draft.autoNext, [marker]: on } });
                  }}
                />
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : null}
      {mode === "playRangeSettings" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-xs font-semibold text-slate-400">
            指定範囲再生の設定
          </legend>
          {draft.playRanges.map((range, index) => (
            <div
              className="grid grid-cols-[5rem_1fr_1fr] items-end gap-2"
              key={PLAY_POINTS[index]}
            >
              <span className="pb-2 text-xs">{`Ctrl/Cmd+F${index + 1}`}</span>
              <SelectField
                label="再生開始位置"
                value={range.start}
                options={pointOptions.filter((point) => point.id !== "tail")}
                onChange={(start) => {
                  change({
                    playRanges: draft.playRanges.map((item, i) =>
                      i === index ? { ...item, start } : item
                    ),
                  });
                }}
              />
              <SelectField
                label="再生終了位置"
                value={range.end}
                options={pointOptions.filter((point) => point.id !== "head")}
                onChange={(end) => {
                  change({
                    playRanges: draft.playRanges.map((item, i) =>
                      i === index ? { ...item, end } : item
                    ),
                  });
                }}
              />
            </div>
          ))}
        </fieldset>
      ) : null}
      {mode === "timingSettings" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-xs font-semibold text-slate-400">
            発声タイミングチェックの設定
          </legend>
          <div className="grid grid-cols-3 gap-2">
            <MsField
              label="テンポ（BPM）"
              value={draft.timing.tempo}
              swatch={null}
              onCommit={(tempo) => {
                if (tempo > 0 && Number.isInteger(tempo) && tempo <= 1000) {
                  change({ timing: { ...draft.timing, tempo } });
                }
              }}
            />
            <MsField
              label="最初に何回クリックを鳴らすか（0〜20回）"
              value={draft.timing.preCount}
              swatch={null}
              onCommit={(preCount) => {
                if (
                  preCount >= 0 &&
                  preCount <= 20 &&
                  Number.isInteger(preCount)
                ) {
                  change({ timing: { ...draft.timing, preCount } });
                }
              }}
            />
            <MsField
              label="音声とクリックの音量バランス（0〜1）"
              value={draft.timing.mix}
              swatch={null}
              onCommit={(mix) => {
                if (mix >= 0 && mix <= 1) {
                  change({ timing: { ...draft.timing, mix } });
                }
              }}
            />
          </div>
          <p className="text-xs text-slate-400">
            BPM = {(60_000 / draft.timing.tempo).toFixed(3)} msec/拍
          </p>
          <label className="text-xs text-slate-400">
            クリック音（WAV）
            <input
              type="file"
              accept=".wav,audio/wav"
              className="mt-1 block w-full text-xs"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  setClickFile(file);
                }
              }}
            />
          </label>
        </fieldset>
      ) : null}
      {mode === "settings" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-xs font-semibold text-slate-400">
            波形・スペクトログラム
          </legend>
          <p className="text-xs text-slate-400">
            表示中のパネルに、設定値の比率で高さを配分します。
          </p>
          <div className="grid grid-cols-2 gap-2">
            <MsField
              label="波形の高さ配分"
              value={draft.waveHeight}
              swatch={null}
              onCommit={(waveHeight) => {
                if (waveHeight >= 50 && waveHeight <= 2000) {
                  change({ waveHeight });
                }
              }}
            />
            <MsField
              label="スペクトログラムの高さ配分"
              value={draft.specHeight}
              swatch={null}
              onCommit={(specHeight) => {
                if (specHeight >= 50 && specHeight <= 2000) {
                  change({ specHeight });
                }
              }}
            />
            <MsField
              label="縦軸最大値（0〜32768、0は自動縮尺）"
              value={draft.waveScale}
              swatch={null}
              onCommit={(waveScale) => {
                if (waveScale >= 0 && waveScale <= 32_768) {
                  change({ waveScale });
                }
              }}
            />
            <MsField
              label="最高周波数（Hz）"
              value={draft.frequencyMax}
              swatch={null}
              onCommit={(frequencyMax) => {
                if (frequencyMax > 0 && frequencyMax <= 96_000) {
                  change({ frequencyMax });
                }
              }}
            />
          </div>
          <SelectField
            label="FFT長（サンプル）"
            value={String(draft.fftSamples)}
            options={FFT_SIZES.map((value) => ({
              id: String(value),
              label: String(value),
            }))}
            onChange={(value) => {
              const fftSamples = FFT_SIZES.find(
                (size) => String(size) === value
              );
              if (fftSamples !== undefined) {
                change({
                  fftSamples,
                  advanced: {
                    ...draft.advanced,
                    windowLength: Math.min(
                      draft.advanced.windowLength,
                      fftSamples
                    ),
                  },
                });
              }
            }}
          />
          <SelectField
            label="スペクトルの色"
            value={draft.spectrumColor}
            options={[
              { id: "gray", label: "grey" },
              { id: "color1", label: "color1" },
              { id: "color2", label: "color2" },
            ]}
            onChange={(spectrumColor) => {
              change({ spectrumColor });
            }}
          />
        </fieldset>
      ) : null}
      {mode === "timingSettings" && clickFile !== null ? (
        <p className="text-xs text-slate-400">
          {clickFile === "default"
            ? "内蔵クリック音を適用します。"
            : `クリック音: ${clickFile.name}`}
        </p>
      ) : null}
      {mode === "timingSettings" ? (
        <Button
          onPress={() => {
            setClickFile("default");
          }}
        >
          内蔵クリック音に戻す
        </Button>
      ) : null}
      {mode === "settings" ? (
        <AdvancedSettingsFields draft={draft} onChange={setDraft} />
      ) : null}
      {settingsPersistenceError === "" ? null : (
        <p role="alert" className="text-xs text-amber-300">
          {settingsPersistenceError}
        </p>
      )}
      <div className="border-line bg-panel sticky -bottom-5 -mb-5 flex justify-end gap-2 border-t pt-3 pb-5">
        {live ? (
          <Button onPress={onClose}>閉じる</Button>
        ) : (
          <>
            {mode === "settings" ? (
              <Button
                onPress={() => {
                  setDraft({
                    ...draft,
                    waveHeight: DEFAULT_SETTINGS.waveHeight,
                    specHeight: DEFAULT_SETTINGS.specHeight,
                    waveScale: DEFAULT_SETTINGS.waveScale,
                    frequencyMax: DEFAULT_SETTINGS.frequencyMax,
                    fftSamples: DEFAULT_SETTINGS.fftSamples,
                    spectrumColor: DEFAULT_SETTINGS.spectrumColor,
                    advanced: {
                      ...structuredClone(DEFAULT_SETTINGS.advanced),
                      showPower: draft.advanced.showPower,
                      showPitch: draft.advanced.showPitch,
                      alwaysOnTop: draft.advanced.alwaysOnTop,
                      opacity: draft.advanced.opacity,
                      allowTrim: draft.advanced.allowTrim,
                      clipboardFormat: draft.advanced.clipboardFormat,
                      autoSaveSettings: draft.advanced.autoSaveSettings,
                      partialRead: draft.advanced.partialRead,
                      partialBefore: draft.advanced.partialBefore,
                      partialAfter: draft.advanced.partialAfter,
                    },
                  });
                }}
              >
                初期値に戻す
              </Button>
            ) : null}
            <Button onPress={onClose}>キャンセル</Button>
            <Button
              onPress={() => {
                void apply();
              }}
            >
              適用
            </Button>
            <Button
              tone="primary"
              onPress={() => {
                void applyAndClose();
              }}
            >
              OK
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export const SettingsDialog = ({
  mode = "settings",
}: {
  mode?: SettingsSection;
}) => (
  <EditorDialog title={SETTINGS_SECTIONS[mode]} onClose={close}>
    <SettingsForm mode={mode} onClose={close} />
  </EditorDialog>
);
