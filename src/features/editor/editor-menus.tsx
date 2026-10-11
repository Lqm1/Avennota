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
  save,
} from "./store";
import { runTool } from "./tools-dialog";

const panel = (id: Exclude<EditorPanel, null>) => () => {
  showEditorPanel(id);
};
const action = (
  id: string,
  label: string,
  run: () => void,
  disabled = false
): EditorMenuEntry => ({
  kind: "action",
  id,
  label,
  handleAction: run,
  disabled,
});
const check = (
  id: string,
  label: string,
  checked: boolean,
  run: () => void,
  disabled = false
): EditorMenuEntry => ({
  kind: "check",
  id,
  label,
  checked,
  handleAction: run,
  disabled,
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
          "音源フォルダを開く（Ctrl+O）",
          () => {
            void openFolder();
          },
          busy
        ),
        action(
          "recent-folders",
          "最近使ったフォルダを開く",
          panel("recentFolders"),
          busy
        ),
        { kind: "separator", id: "folder-separator" },
        action("open-ini", "原音パラメータの読み込み", panel("fileOpen"), busy),
        action(
          "save",
          "上書き保存（Ctrl+S）",
          () => {
            void save();
          },
          busy
        ),
        action(
          "save-as",
          "名前を付けて保存（Ctrl+Shift+S）",
          panel("fileSave"),
          busy
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
                  "読み込む",
                  fileSettings("read", section),
                  busy
                ),
                action(
                  `${section}-write`,
                  "書き出す",
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
        submenu("horizontal-scale", "横軸の拡大", [
          action("zoom-in", "拡大（F12）", () => waveControls()?.zoom(1.5)),
          action("zoom-out", "縮小（F11）", () =>
            waveControls()?.zoom(1 / 1.5)
          ),
          action("fit", "全体表示", () => waveControls()?.fit()),
        ]),
        submenu("time-axis", "時間軸", [
          check("seconds", "秒", settings.timeUnit === "seconds", () => {
            apply({ timeUnit: "seconds" });
          }),
          check("bars", "小節", settings.timeUnit === "bars", () => {
            apply({ timeUnit: "bars" });
          }),
          action("bpm", "BPMと開始位置", panel("bpm")),
        ]),
        { kind: "separator", id: "panels-separator" },
        check("wave", "波形を表示", settings.showWave, () => {
          apply({ showWave: !settings.showWave });
        }),
        check("spectrum", "スペクトログラムを表示", settings.showSpec, () => {
          apply({ showSpec: !settings.showSpec });
        }),
        check("power", "パワーを表示", advanced.showPower, () => {
          apply({ advanced: { ...advanced, showPower: !advanced.showPower } });
        }),
        check("pitch", "F0を表示", advanced.showPitch, () => {
          apply({ advanced: { ...advanced, showPitch: !advanced.showPitch } });
        }),
        { kind: "separator", id: "window-separator" },
        check("whole", "常にWAV全体を表示する", settings.showWhole, () => {
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
              action("opacity", "画面を透過する", panel("opacity")),
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
        submenu("input", "マウス、キー操作の設定", [
          submenu("offset", "マウスで左ブランクを動かしたとき、", [
            check(
              "offset-relative",
              "他パラメータも一緒に動かして相対的な位置関係を保つ。(Shift+l)",
              settings.offsetMode === "relative",
              () => {
                apply({ offsetMode: "relative" });
              }
            ),
            check(
              "offset-positions",
              "他パラメータは動かさず、左ブランクのみを動かす。(Ctrl+Shift+l)",
              settings.offsetMode === "positions",
              () => {
                apply({ offsetMode: "positions" });
              }
            ),
          ]),
          submenu("preutter", "マウスで先行発声を動かしたとき、", [
            check(
              "preutter-relative",
              "他パラメータも一緒に動かして相対的な位置関係を保つ。(Shift+p)",
              settings.preutterMode === "relative",
              () => {
                apply({ preutterMode: "relative" });
              }
            ),
            check(
              "preutter-independent",
              "他パラメータは動かさず、先行発声のみを動かす。(Shift+p)",
              settings.preutterMode === "independent",
              () => {
                apply({ preutterMode: "independent" });
              }
            ),
          ]),
          check(
            "overlap",
            "オーバーラップを負にしても良い",
            settings.negativeOverlap,
            () => {
              apply({ negativeOverlap: !settings.negativeOverlap });
            }
          ),
          check(
            "broom",
            "左右ブランクの移動可能範囲を他パラメータより優先する",
            settings.blankBroom,
            () => {
              apply({ blankBroom: !settings.blankBroom });
            }
          ),
          check(
            "trim",
            "F9で左右ブランクの両側波形をカットする(単独音向け機能)",
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
            "画面クリックで近傍パラメータ間を再生する",
            settings.clickMode === "range",
            () => {
              apply({
                clickMode: settings.clickMode === "range" ? "none" : "range",
              });
            },
            settings.clickMode === "timing"
          ),
        ]),
        submenu("cutoff", "右ブランク値の表現方法", [
          check(
            "cutoff-positive",
            "ファイル末尾からの時間(正の値で表現)",
            settings.cutoffMode === "positive",
            () => {
              apply({ cutoffMode: "positive" });
            }
          ),
          check(
            "cutoff-negative",
            "左ブランクからの時間(負の値で表現)",
            settings.cutoffMode === "negative",
            () => {
              apply({ cutoffMode: "negative" });
            }
          ),
        ]),
        { kind: "separator", id: "play-separator" },
        action(
          "timing",
          "発声タイミングチェックの設定(再生=F8)",
          panel("timingSettings")
        ),
        action("ranges", "指定範囲再生の設定", panel("playRangeSettings")),
        check(
          "follow",
          "再生位置に追随して画面をスクロールさせる",
          settings.followPlayMark,
          () => {
            apply({ followPlayMark: !settings.followPlayMark });
          }
        ),
        check(
          "return",
          "再生後に元の描画位置に戻る",
          settings.returnToPlayStart,
          () => {
            apply({ returnToPlayStart: !settings.returnToPlayStart });
          }
        ),
        action(
          "focus",
          "パラメータへの自動フォーカス設定",
          panel("focusSettings")
        ),
        action(
          "next",
          "原音設定したら次のエントリに自動で移動する設定",
          panel("nextSettings")
        ),
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
          "設定変更を自動保存する",
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
        action("details", "詳細設定", panel("settings")),
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
        submenu("wav", "wavファイルの一括編集", [
          action(
            "dc",
            "DC成分の一括除去",
            () => {
              processAll("dc");
            },
            disabled
          ),
          action(
            "rename",
            "wavファイル名の先頭に「_」を追加(連続音用)",
            () => {
              void runTool(async () => {
                await renameWavs(false);
              });
            },
            disabled
          ),
          action(
            "rename-related",
            "wavファイル名(や周波数ファイル)の先頭に「_」を追加(連続音用)",
            () => {
              void runTool(async () => {
                await renameWavs(true);
              });
            },
            disabled
          ),
          action("cut", "wavの両端を一括カット", panel("wavCut"), disabled),
          action(
            "mono",
            "wavファイルの一括モノラル化",
            () => {
              processAll("mono");
            },
            disabled
          ),
        ]),
        submenu("finish", "仕上げ、補完用ツール", [
          action(
            "continuous",
            "連続音oto.iniに無いエイリアスを探し、単独音で補完する",
            () => {
              void runTool(complement);
            },
            disabled
          ),
          action(
            "kana",
            "「を」が無い場合「お」で補完する",
            () => {
              transformOtoSet((set) => complementAliases(set, "kana"));
            },
            disabled
          ),
        ]),
        submenu("sort", "パラメータ一覧の並び替え", [
          action(
            "kana-order",
            "仮名順に並び替え",
            () => {
              transformOtoSet((set) => sortRows(set, "kana"));
            },
            disabled
          ),
          action(
            "wav-order",
            "wavファイル名順に並び替え",
            () => {
              transformOtoSet((set) => sortRows(set, "wav"));
            },
            disabled
          ),
        ]),
        { kind: "separator", id: "alias-separator" },
        action("alias", "エイリアス一括変更", panel("alias"), disabled),
        ...(isTauri()
          ? [
              action(
                "explorer",
                "保存フォルダをエクスプローラで開く",
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
        action("extra", "ファイル・コメント・UST", panel("tools")),
      ]}
    />
  );
};
