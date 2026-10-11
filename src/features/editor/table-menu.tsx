import { useEffect, useRef } from "react";
import { Menu, MenuItem, Separator } from "react-aria-components";
import { createPortal } from "react-dom";

import { playTiming } from "../audio/timing-player";
import { waveControls } from "../audio/wave-controls";
import { clipboardAction } from "./cell-clipboard";
import { cellSelectionStore } from "./cell-selection";
import { showEditorPanel } from "./settings";
import { editorStore } from "./store";

export const TableMenu = ({
  position,
  onClose,
}: {
  position: { x: number; y: number };
  onClose: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        ref.current?.contains(event.target) === false
      ) {
        onClose();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);
  const itemClass =
    "cursor-default px-3 py-1.5 text-xs text-slate-200 outline-none data-focused:bg-white/10";
  return createPortal(
    <div
      ref={ref}
      className="border-line bg-panel fixed z-40 w-64 rounded border py-1 shadow-xl"
      style={{ left: position.x, top: position.y }}
    >
      <Menu
        aria-label="一覧操作"
        autoFocus
        onAction={(key) => {
          const { workspace } = editorStore.state;
          if (
            workspace.kind === "open" &&
            (key === "copy" || key === "cut" || key === "paste")
          ) {
            const { selectedId } = workspace.history.present;
            const active =
              cellSelectionStore.state?.active ??
              (selectedId === null
                ? null
                : { lineId: selectedId, column: "alias" as const });
            if (active !== null) {
              void clipboardAction(key, active, selectedId);
            }
          }
          if (key === "bulk" || key === "alias" || key === "settings") {
            showEditorPanel(key);
          }
          if (key === "play") {
            waveControls()?.playAll();
          }
          if (key === "timing") {
            void playTiming();
          }
          onClose();
        }}
      >
        <MenuItem id="copy" className={itemClass}>
          コピー（Ctrl+C）
        </MenuItem>
        <MenuItem id="cut" className={itemClass}>
          切り取り（Ctrl+X）
        </MenuItem>
        <MenuItem id="paste" className={itemClass}>
          貼り付け（Ctrl+V）
        </MenuItem>
        <Separator className="border-line my-1 border-t" />
        <MenuItem id="bulk" className={itemClass}>
          値一括変更（Ctrl+M）
        </MenuItem>
        <MenuItem id="alias" className={itemClass}>
          エイリアス一括変更
        </MenuItem>
        <Separator className="border-line my-1 border-t" />
        <MenuItem id="play" className={itemClass}>
          全体再生・停止（Ctrl+P）
        </MenuItem>
        <MenuItem id="timing" className={itemClass}>
          発声タイミング試聴（F8）
        </MenuItem>
        <MenuItem id="settings" className={itemClass}>
          設定…
        </MenuItem>
      </Menu>
    </div>,
    document.body
  );
};
