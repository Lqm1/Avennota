import { isTauri } from "@tauri-apps/api/core";

import { EditorMenu } from "../../components/ui/editor-menu";
import type { EditorMenuEntry } from "../../components/ui/editor-menu";
import { pickDocument } from "../../platform/files/documents";
import { waveControls } from "../audio/wave-controls";
import { parseOto } from "../oto/oto-set";
import { applyEditorSettings } from "./apply-settings";
import { processWavs, renameWavs } from "./file-tools";
import { complementAliases, sortRows } from "./manual-tools";
import {
  settingsStore,
  showEditorPanel,
  useSettings,
  persistSettings,
} from "./settings";
import type { EditorSettings, EditorPanel } from "./settings";
import { settingsFile } from "./settings-file";
import {
  ask,
  editorStore,
  transformOtoSet,
  useEditor,
  openFolder,
  runTool,
  save,
} from "./store";

const panel = (id: Exclude<EditorPanel, null>) => () => {
  showEditorPanel(id);
};
const action = (
  id: string,
  label: string,
  run: () => void,
  disabled = false,
  shortcut?: string
): EditorMenuEntry => ({
  kind: "action",
  id,
  label,
  handleAction: run,
  disabled,
  shortcut,
});
const check = (
  id: string,
  label: string,
  checked: boolean,
  run: () => void,
  disabled = false,
  shortcut?: string
): EditorMenuEntry => ({
  kind: "check",
  id,
  label,
  checked,
  handleAction: run,
  disabled,
  shortcut,
});
const submenu = (
  id: string,
  label: string,
  entries: EditorMenuEntry[]
): EditorMenuEntry => ({ kind: "submenu", id, label, entries });
const apply = (patch: Partial<EditorSettings>) => {
  void runTool(async () => {
    await applyEditorSettings({ ...settingsStore.state, ...patch });
  });
};

const fileSettings =
  (mode: "read" | "write", section: "all" | "appearance" | "analysis") =>
  () => {
    void settingsFile(mode, section, settingsStore.state, async (next) => {
      await applyEditorSettings(next);
    });
  };

export const FileMenu = () => {
  const busy = useEditor((state) => state.busy !== "");
  return (
    <EditorMenu
      label="ファイル"
      entries={[
        action(
          "open-folder",
          "音源フォルダを開く",
          () => {
            void openFolder();
          },
          busy,
          "Ctrl+O"
        ),
        action(
          "recent-folders",
          "最近使ったフォルダを開く…",
          panel("recentFolders"),
          busy
        ),
        { kind: "separator", id: "folder-separator" },
        action(
          "open-ini",
          "原音設定ファイルを読み込む…",
          panel("fileOpen"),
          busy
        ),
        action(
          "save",
          "上書き保存",
          () => {
            void save();
          },
          busy,
          "Ctrl+S"
        ),
        action(
          "save-as",
          "名前を付けて保存…",
          panel("fileSave"),
          busy,
          "Ctrl+Shift+S"
        ),
        { kind: "separator", id: "settings-separator" },
        submenu("settings-file", "設定ファイル", [
          ...(["all", "appearance", "analysis"] as const).map((section) =>
            submenu(
              section,
              {
                all: "すべての設定",
                appearance: "色・文字",
                analysis: "解析条件",
              }[section],
              [
                action(
                  `${section}-read`,
                  "読み込む…",
                  fileSettings("read", section),
                  busy
                ),
                action(
                  `${section}-write`,
                  "書き出す…",
                  fileSettings("write", section),
                  busy
                ),
              ]
            )
          ),
          action(
            "persist-settings",
            "現在の設定を保存",
            () => {
              void persistSettings();
            },
            busy
          ),
        ]),
      ]}
    />
  );
};

export const ViewMenu = () => {
  const settings = useSettings();
  const { advanced } = settings;
  return (
    <EditorMenu
      label="表示"
      entries={[
        submenu("horizontal-scale", "横軸の拡大・縮小", [
          action(
            "zoom-in",
            "拡大",
            () => waveControls()?.zoom(1.5),
            false,
            "F12"
          ),
          action(
            "zoom-out",
            "縮小",
            () => waveControls()?.zoom(1 / 1.5),
            false,
            "F11"
          ),
          action("fit", "波形全体を表示", () => waveControls()?.fit()),
        ]),
        submenu("time-axis", "時間軸", [
          check("seconds", "秒単位", settings.timeUnit === "seconds", () => {
            apply({ timeUnit: "seconds" });
          }),
          check("bars", "小節単位", settings.timeUnit === "bars", () => {
            apply({ timeUnit: "bars" });
          }),
          action("bpm", "BPMと開始位置…", panel("bpm")),
        ]),
        { kind: "separator", id: "panels-separator" },
        check("wave", "波形", settings.showWave, () => {
          apply({ showWave: !settings.showWave });
        }),
        check("spectrum", "スペクトログラム", settings.showSpec, () => {
          apply({ showSpec: !settings.showSpec });
        }),
        check("power", "音量パワー", advanced.showPower, () => {
          apply({ advanced: { ...advanced, showPower: !advanced.showPower } });
        }),
        check("pitch", "ピッチ（F0）", advanced.showPitch, () => {
          apply({ advanced: { ...advanced, showPitch: !advanced.showPitch } });
        }),
        { kind: "separator", id: "window-separator" },
        check("whole", "常に波形全体を表示", settings.showWhole, () => {
          apply({ showWhole: !settings.showWhole });
        }),
        ...(isTauri()
          ? [
              check(
                "always-on-top",
                "常に最前面に表示",
                advanced.alwaysOnTop,
                () => {
                  apply({
                    advanced: {
                      ...advanced,
                      alwaysOnTop: !advanced.alwaysOnTop,
                    },
                  });
                }
              ),
              action(
                "opacity",
                "ウィンドウの透過（Windowsのみ）…",
                panel("opacity")
              ),
            ]
          : []),
      ]}
    />
  );
};

export const OptionsMenu = () => {
  const settings = useSettings();
  return (
    <EditorMenu
      label="オプション"
      entries={[
        submenu("input", "マウス・キー操作", [
          submenu("offset", "左ブランクドラッグ時の動作", [
            check(
              "offset-relative",
              "他のマーカーも連動して移動",
              settings.offsetMode === "relative",
              () => {
                apply({ offsetMode: "relative" });
              },
              false,
              "Shift+L"
            ),
            check(
              "offset-positions",
              "左ブランクのみ単独で移動",
              settings.offsetMode === "positions",
              () => {
                apply({ offsetMode: "positions" });
              },
              false,
              "Ctrl+Shift+L"
            ),
          ]),
          submenu("preutter", "先行発声ドラッグ時の動作", [
            check(
              "preutter-relative",
              "他のマーカーも連動して移動",
              settings.preutterMode === "relative",
              () => {
                apply({ preutterMode: "relative" });
              },
              false,
              "Shift+P"
            ),
            check(
              "preutter-independent",
              "先行発声のみ単独で移動",
              settings.preutterMode === "independent",
              () => {
                apply({ preutterMode: "independent" });
              },
              false,
              "Shift+P"
            ),
          ]),
          check(
            "overlap",
            "オーバーラップの負の値を許可",
            settings.negativeOverlap,
            () => {
              apply({ negativeOverlap: !settings.negativeOverlap });
            }
          ),
          check(
            "broom",
            "左右ブランクの移動で他マーカーを押し出す（ほうきモード）",
            settings.blankBroom,
            () => {
              apply({ blankBroom: !settings.blankBroom });
            }
          ),
          check(
            "trim",
            "左右ブランクの外側波形をカット（単独音用 / F9）",
            settings.advanced.allowTrim,
            () => {
              apply({
                advanced: {
                  ...settings.advanced,
                  allowTrim: !settings.advanced.allowTrim,
                },
              });
            }
          ),
          check(
            "timing-mode",
            "発声タイミング補正モード",
            settings.clickMode === "timing",
            () => {
              apply({
                clickMode: settings.clickMode === "timing" ? "none" : "timing",
              });
            }
          ),
          check(
            "click-range",
            "クリックした区間を再生",
            settings.clickMode === "range",
            () => {
              apply({
                clickMode: settings.clickMode === "range" ? "none" : "range",
              });
            },
            settings.clickMode === "timing"
          ),
        ]),
        submenu("cutoff", "右ブランクの数値表現", [
          check(
            "cutoff-positive",
            "音声末尾からの時間（正の値）",
            settings.cutoffMode === "positive",
            () => {
              apply({ cutoffMode: "positive" });
            }
          ),
          check(
            "cutoff-negative",
            "左ブランクからの時間（負の値）",
            settings.cutoffMode === "negative",
            () => {
              apply({ cutoffMode: "negative" });
            }
          ),
        ]),
        { kind: "separator", id: "play-separator" },
        action(
          "timing",
          "発声タイミング確認の設定…",
          panel("timingSettings"),
          false,
          "F8"
        ),
        action("ranges", "区間再生の設定…", panel("playRangeSettings")),
        check(
          "follow",
          "再生位置に合わせて自動スクロール",
          settings.followPlayMark,
          () => {
            apply({ followPlayMark: !settings.followPlayMark });
          }
        ),
        check(
          "return",
          "再生終了後に元の位置へ戻る",
          settings.returnToPlayStart,
          () => {
            apply({ returnToPlayStart: !settings.returnToPlayStart });
          }
        ),
        action(
          "focus",
          "パラメータの自動フォーカス設定…",
          panel("focusSettings")
        ),
        action("next", "設定完了時の自動移動設定…", panel("nextSettings")),
        { kind: "separator", id: "general-separator" },
        submenu("clipboard", "セルのコピー形式", [
          check(
            "csv",
            "CSV（カンマ区切り）",
            settings.advanced.clipboardFormat === "csv",
            () => {
              apply({
                advanced: { ...settings.advanced, clipboardFormat: "csv" },
              });
            }
          ),
          check(
            "tsv",
            "表計算用（タブ区切り）",
            settings.advanced.clipboardFormat === "tsv",
            () => {
              apply({
                advanced: { ...settings.advanced, clipboardFormat: "tsv" },
              });
            }
          ),
        ]),
        check(
          "auto-save-settings",
          "設定の変更を自動保存",
          settings.advanced.autoSaveSettings,
          () => {
            apply({
              advanced: {
                ...settings.advanced,
                autoSaveSettings: !settings.advanced.autoSaveSettings,
              },
            });
          }
        ),
        action("details", "詳細設定…", panel("settings")),
      ]}
    />
  );
};

const complement = async () => {
  const choice = await ask({
    title: "エイリアスの補完",
    message: "別フォルダの連続音oto.iniを参照しますか？",
    actions: [
      { id: "yes", label: "はい" },
      { id: "no", label: "いいえ" },
      { id: "cancel", label: "キャンセル" },
    ],
  });
  if (choice === "cancel") {
    return;
  }
  const known = new Set<string>();
  if (choice === "yes") {
    const file = await pickDocument(["ini"]);
    if (file === null) {
      return;
    }
    for (const line of parseOto(file.bytes).lines) {
      if (line.parsed.kind === "oto" && line.parsed.oto.alias !== "") {
        known.add(line.parsed.oto.alias);
      }
    }
  }
  transformOtoSet((set) => complementAliases(set, "continuous", known));
};
const processAll = (mode: "dc" | "mono") => {
  void runTool(async () => {
    const { workspace } = editorStore.state;
    if (workspace.kind === "open") {
      await processWavs([...workspace.session.wavs.values()], {
        dc: mode === "dc",
        mono: mode === "mono",
        headMs: 0,
        tailMs: 0,
      });
    }
  });
};
export const ToolsMenu = () => {
  const disabled = useEditor(
    (state) => state.workspace.kind === "closed" || state.busy !== ""
  );
  return (
    <EditorMenu
      label="ツール"
      entries={[
        action(
          "alignment",
          "原音設定の自動推定…",
          panel("alignment"),
          disabled
        ),
        submenu("wav", "WAVファイルの一括編集", [
          action(
            "dc",
            "DCオフセットの一括除去",
            () => {
              processAll("dc");
            },
            disabled
          ),
          action(
            "rename",
            "WAVファイル名の先頭に「_」を付与（連続音用）",
            () => {
              void runTool(async () => {
                await renameWavs(false);
              });
            },
            disabled
          ),
          action(
            "rename-related",
            "WAV名と周波数表の先頭に「_」を付与（連続音用）",
            () => {
              void runTool(async () => {
                await renameWavs(true);
              });
            },
            disabled
          ),
          action("cut", "WAVの両端を一括カット…", panel("wavCut"), disabled),
          action(
            "mono",
            "WAVファイルの一括モノラル化",
            () => {
              processAll("mono");
            },
            disabled
          ),
        ]),
        submenu("finish", "エイリアスの補完・仕上げ", [
          action(
            "continuous",
            "連続音に不足しているエイリアスを単独音で補完…",
            () => {
              void runTool(complement);
            },
            disabled
          ),
          action(
            "kana",
            "不足している「を」のエイリアスを「お」で補完",
            () => {
              transformOtoSet((set) => complementAliases(set, "kana"));
            },
            disabled
          ),
        ]),
        submenu("sort", "原音設定行の並び替え", [
          action(
            "kana-order",
            "50音順に並び替え",
            () => {
              transformOtoSet((set) => sortRows(set, "kana"));
            },
            disabled
          ),
          action(
            "wav-order",
            "WAVファイル名順に並び替え",
            () => {
              transformOtoSet((set) => sortRows(set, "wav"));
            },
            disabled
          ),
        ]),
        { kind: "separator", id: "alias-separator" },
        action("alias", "エイリアスの一括変更…", panel("alias"), disabled),
        submenu("batch", "原音設定の一括処理", [
          action("query", "検索・置換・抽出…", panel("query"), disabled),
          action(
            "alias-rules",
            "規則によるエイリアスの複製・置換…",
            panel("aliasRules"),
            disabled
          ),
          action(
            "duplicates",
            "重複エイリアスの整理…",
            panel("duplicates"),
            disabled
          ),
          action(
            "parameters",
            "先行発声・オーバーラップの一括調整…",
            panel("parameters"),
            disabled
          ),
          action(
            "conversion",
            "連続音からCV・VCを追加…",
            panel("conversion"),
            disabled
          ),
        ]),
        ...(isTauri()
          ? [
              action(
                "explorer",
                "音源フォルダをエクスプローラーで開く",
                () => {
                  void runTool(async () => {
                    const { workspace } = editorStore.state;
                    if (workspace.kind === "open") {
                      await (
                        workspace.session.storageFolder ??
                        workspace.session.folder
                      ).openInManager?.();
                    }
                  });
                },
                disabled
              ),
            ]
          : []),
        { kind: "separator", id: "extra-separator" },
        action("extra", "ファイル・コメント・UST連携…", panel("tools")),
      ]}
    />
  );
};
