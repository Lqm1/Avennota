import { useEffect, useRef } from "react";
import { Menu, MenuItem, Separator } from "react-aria-components";

import {
  settingsStore,
  showEditorPanel,
  updateSettings,
  useSettings,
} from "../editor/settings";
import { waveControls } from "./wave-controls";

export const WaveMenu = ({
  position,
  onClose,
}: {
  position: { x: number; y: number };
  onClose: () => void;
}) => {
  const settings = useSettings();
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
    "flex cursor-default items-center justify-between px-3 py-1.5 text-xs text-slate-200 outline-none data-focused:bg-white/10";
  return (
    <div
      ref={ref}
      className="border-line bg-panel fixed z-40 w-64 rounded border py-1 shadow-xl"
      style={{ left: position.x, top: position.y }}
    >
      <Menu
        aria-label="波形操作メニュー"
        autoFocus
        onAction={(key) => {
          const current = settingsStore.state;
          if (key === "in") {
            waveControls()?.zoom(1.5);
          }
          if (key === "out") {
            waveControls()?.zoom(1 / 1.5);
          }
          if (key === "fit") {
            waveControls()?.fit();
          }
          if (key === "range" && current.clickMode !== "timing") {
            updateSettings({
              clickMode: current.clickMode === "range" ? "none" : "range",
            });
          }
          if (key === "timing") {
            updateSettings({
              clickMode: current.clickMode === "timing" ? "none" : "timing",
            });
          }
          if (key === "offset") {
            updateSettings({
              offsetMode:
                current.offsetMode === "positions" ? "relative" : "positions",
            });
          }
          if (key === "preutter") {
            updateSettings({
              preutterMode:
                current.preutterMode === "independent"
                  ? "relative"
                  : "independent",
            });
          }
          if (key === "wave") {
            updateSettings({ showWave: !current.showWave });
          }
          if (key === "spec") {
            updateSettings({ showSpec: !current.showSpec });
          }
          if (key === "settings") {
            showEditorPanel("settings");
          }
          onClose();
        }}
      >
        <MenuItem id="in" className={itemClass}>
          <span>拡大</span>
          <kbd className="text-[10px] text-slate-400">F12</kbd>
        </MenuItem>
        <MenuItem id="out" className={itemClass}>
          <span>縮小</span>
          <kbd className="text-[10px] text-slate-400">F11</kbd>
        </MenuItem>
        <MenuItem id="fit" className={itemClass}>
          <span>波形全体を表示</span>
        </MenuItem>
        <Separator className="border-line my-1 border-t" />
        <MenuItem id="timing" className={itemClass}>
          <span>発声タイミング補正モード</span>
          <span className="text-accent">
            {settings.clickMode === "timing" ? "✓" : ""}
          </span>
        </MenuItem>
        <MenuItem
          id="range"
          className={itemClass}
          isDisabled={settings.clickMode === "timing"}
        >
          <span>パラメータ区間をクリック再生</span>
          <span className="text-accent">
            {settings.clickMode === "range" ? "✓" : ""}
          </span>
        </MenuItem>
        <MenuItem id="offset" className={itemClass}>
          <span>左ブランク移動時に他マーカーも連動</span>
          <span className="text-accent">
            {settings.offsetMode === "relative" ? "✓" : ""}
          </span>
        </MenuItem>
        <MenuItem id="preutter" className={itemClass}>
          <span>先行発声移動時に他マーカーも連動</span>
          <span className="text-accent">
            {settings.preutterMode === "relative" ? "✓" : ""}
          </span>
        </MenuItem>
        <Separator className="border-line my-1 border-t" />
        <MenuItem id="wave" className={itemClass}>
          <span>波形を表示</span>
          <span className="text-accent">{settings.showWave ? "✓" : ""}</span>
        </MenuItem>
        <MenuItem id="spec" className={itemClass}>
          <span>スペクトログラムを表示</span>
          <span className="text-accent">{settings.showSpec ? "✓" : ""}</span>
        </MenuItem>
        <MenuItem id="settings" className={itemClass}>
          <span>設定…</span>
        </MenuItem>
      </Menu>
    </div>
  );
};
