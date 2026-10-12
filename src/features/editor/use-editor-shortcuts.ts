import type {
  RegisterableHotkey,
  UseHotkeyDefinition,
} from "@tanstack/react-hotkeys";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useEffect, useLayoutEffect, useRef } from "react";

import { playTiming } from "../audio/timing-player";
import { waveControls } from "../audio/wave-controls";
import { MARKERS } from "../oto/geometry";
import { cellSelectionStore, selectedCells } from "./cell-selection";
import { trimSelectedWav } from "./file-tools";
import { editorCommand } from "./keyboard-commands";
import type { EditorCommand } from "./keyboard-commands";
import {
  editorPanelStore,
  settingsStore,
  showEditorPanel,
  updateSettings,
} from "./settings";
import {
  deleteLineKeepingWav,
  duplicateLine,
  editorStore,
  redo,
  save,
  selectRelative,
  selectRelativeWav,
  undo,
  notify,
} from "./store";

interface ShortcutHandlers {
  focusSearch: () => void;
  findNext: (direction: 1 | -1) => void;
}
const bind = (
  keys: RegisterableHotkey[],
  callback: () => void,
  inInputs = false
): UseHotkeyDefinition[] =>
  keys.map((hotkey) => ({
    hotkey,
    callback,
    options: { ignoreInputs: !inInputs, preventDefault: true },
  }));
const selected = (action: (id: string) => void): void => {
  const { workspace } = editorStore.state;
  if (workspace.kind === "closed") {
    return;
  }
  const { otoSet, selectedId } = workspace.history.present;
  if (selectedId === null) {
    return;
  }
  const ids = new Set(
    selectedCells(otoSet, cellSelectionStore.state, selectedId).map(
      (cell) => cell.lineId
    )
  );
  if (ids.size > 1) {
    notify("warning", "この操作は1行だけ選択してください。");
    return;
  }
  action(selectedId);
};
const blocked = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest(
    'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], [role="separator"]'
  ) !== null;
const pausedInput = (event: KeyboardEvent): boolean =>
  event.isComposing ||
  editorPanelStore.state !== null ||
  editorStore.state.dialog !== null;

const handleTableGlobal = (
  event: KeyboardEvent,
  handlers: ShortcutHandlers,
  table: boolean
): boolean => {
  if (!table) {
    return false;
  }
  const action = event.key.toLowerCase();
  if (
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    !["f", "g", "n", "z", "y"].includes(action)
  ) {
    return false;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  if (action === "f") {
    handlers.focusSearch();
    return true;
  }
  if (document.activeElement instanceof HTMLInputElement) {
    document.activeElement.blur();
  }
  if (action === "g" || action === "n") {
    handlers.findNext(event.shiftKey ? -1 : 1);
  } else if (action === "y" || event.shiftKey) {
    redo();
  } else {
    undo();
  }
  return true;
};

export const useEditorShortcuts = ({
  focusSearch,
  findNext,
}: ShortcutHandlers): void => {
  const handlers = useRef({ focusSearch, findNext });
  useLayoutEffect(() => {
    handlers.current = { focusSearch, findNext };
  });
  useHotkeys([
    ...bind(["Control+F", "Meta+F"], focusSearch),
    ...bind(["Control+G", "Control+N", "Meta+G", "Meta+N"], () => {
      findNext(1);
    }),
    ...bind(
      [
        "Control+Shift+G",
        "Control+Shift+N",
        { key: "G", meta: true, shift: true },
        { key: "N", meta: true, shift: true },
      ],
      () => {
        findNext(-1);
      }
    ),
    ...bind(["Control+Z", "Meta+Z"], undo),
    ...bind(
      [
        "Control+Y",
        "Control+Shift+Z",
        "Meta+Y",
        { key: "Z", meta: true, shift: true },
      ],
      redo
    ),
  ]);
  useEffect(() => {
    let held: string | null = null;
    const release = () => {
      if (held !== null) {
        waveControls()?.endMarker();
        held = null;
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key === held) {
        release();
      }
    };
    const keydown = (event: KeyboardEvent) => {
      if (pausedInput(event)) {
        return;
      }
      const table =
        event.target instanceof Element &&
        event.target.closest("[data-oto-table]") !== null;
      if (blocked(event.target) && !table) {
        return;
      }
      const { key } = event;
      const control = event.ctrlKey || event.metaKey;
      if (handleTableGlobal(event, handlers.current, table)) {
        return;
      }
      const marker = MARKERS[Number(key.slice(1)) - 1];
      if (/^F[1-5]$/u.test(key) && marker !== undefined) {
        event.preventDefault();
        if (control) {
          if (!event.repeat) {
            waveControls()?.playPreset(Number(key.slice(1)) - 1);
          }
        } else if (
          (!event.altKey || marker === "offset" || marker === "preutter") &&
          !event.shiftKey &&
          held === null
        ) {
          held = key;
          waveControls()?.beginMarker(marker, event.altKey);
        }
        return;
      }
      const audio = waveControls();
      const command = editorCommand(event, table);
      const actions: Record<EditorCommand, () => void> = {
        trim: () => {
          void trimSelectedWav();
        },
        timing: () => {
          void playTiming();
        },
        next: () => {
          selectRelative(1);
        },
        previous: () => {
          selectRelative(-1);
        },
        nextWav: () => {
          selectRelativeWav(1);
        },
        previousWav: () => {
          selectRelativeWav(-1);
        },
        play: () => audio?.playAll(),
        range: () => audio?.playRange(),
        visible: () => audio?.playVisible(),
        stop: () => {
          audio?.stop();
        },
        bulk: () => {
          showEditorPanel("bulk");
        },
        duplicate: () => {
          selected(duplicateLine);
        },
        delete: () => {
          selected(deleteLineKeepingWav);
        },
        left: () => audio?.scroll(-0.1),
        right: () => audio?.scroll(0.1),
        pageLeft: () => audio?.scroll(-0.9),
        pageRight: () => audio?.scroll(0.9),
        start: () => audio?.scrollToStart(),
        zoomIn: () => audio?.zoom(1.5),
        zoomOut: () => audio?.zoom(1 / 1.5),
        reload: () => audio?.reload(),
        toggleP: () => {
          updateSettings({
            preutterMode:
              settingsStore.state.preutterMode === "relative"
                ? "independent"
                : "relative",
          });
        },
        offsetPositions: () => {
          updateSettings({ offsetMode: "positions" });
        },
        toggleS: () => {
          updateSettings({
            offsetMode:
              settingsStore.state.offsetMode === "relative"
                ? "positions"
                : "relative",
          });
        },
      };
      const action = command === null ? undefined : actions[command];
      if (action !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        action();
      }
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", release);
    return () => {
      release();
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", release);
    };
  }, []);
};

export const useGlobalShortcuts = (): void => {
  useHotkeys([
    ...bind(
      ["Control+S", "Meta+S"],
      () => {
        void save();
      },
      true
    ),
    ...bind(
      ["Control+O", "Meta+O"],
      () => {
        showEditorPanel("fileOpen");
      },
      true
    ),
    ...bind(
      ["Control+Shift+S", { key: "S", meta: true, shift: true }],
      () => {
        showEditorPanel("fileSave");
      },
      true
    ),
  ]);
};
