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
    "cursor-default px-3 py-1.5 text-xs text-slate-200 outline-none data-focused:bg-white/10";
  return (
    <div
      ref={ref}
      className="border-line bg-panel fixed z-40 w-64 rounded border py-1 shadow-xl"
      style={{ left: position.x, top: position.y }}
    >
      <Menu
        aria-label="波形操作"
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
          拡大（F12）
        </MenuItem>
        <MenuItem id="out" className={itemClass}>
          縮小（F11）
        </MenuItem>
        <MenuItem id="fit" className={itemClass}>
          全体表示
        </MenuItem>
        <Separator className="border-line my-1 border-t" />
        <MenuItem id="timing" className={itemClass}>
          {settings.clickMode === "timing" ? "✓ " : ""}発声タイミング補正モード
        </MenuItem>
        <MenuItem
          id="range"
          className={itemClass}
          isDisabled={settings.clickMode === "timing"}
        >
          {settings.clickMode === "range" ? "✓ " : ""}
          近傍パラメータ間をクリック再生
        </MenuItem>
        <MenuItem id="offset" className={itemClass}>
          {settings.offsetMode === "relative" ? "✓ " : ""}左ブランクに連動
        </MenuItem>
        <MenuItem id="preutter" className={itemClass}>
          {settings.preutterMode === "relative" ? "✓ " : ""}先行発声に連動
        </MenuItem>
        <Separator className="border-line my-1 border-t" />
        <MenuItem id="wave" className={itemClass}>
          {settings.showWave ? "✓ " : ""}波形を表示
        </MenuItem>
        <MenuItem id="spec" className={itemClass}>
          {settings.showSpec ? "✓ " : ""}スペクトログラムを表示
        </MenuItem>
        <MenuItem id="settings" className={itemClass}>
          設定…
        </MenuItem>
      </Menu>
    </div>
  );
};
