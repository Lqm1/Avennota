import {
  FoldHorizontal,
  Link2,
  Metronome,
  Play,
  Square,
  SquarePlay,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Toolbar as AriaToolbar } from "react-aria-components";

import { Button } from "../../components/ui/button";
import { Tip, ToolButton, ToolToggle } from "../../components/ui/tool-button";
import { playTiming } from "../audio/timing-player";
import { waveControls } from "../audio/wave-controls";
import { MARKERS, MARKER_KEYS, MARKER_LABELS } from "../oto/geometry";
import { ParamSwatch } from "./param-swatch";
import { updateSettings, useSettings } from "./settings";
import { divider } from "./toolbar";

export const WaveToolbar = () => {
  const settings = useSettings();
  return (
    <AriaToolbar
      aria-label="波形操作ツールバー"
      className="border-line bg-panel/60 @container flex h-8 shrink-0 flex-nowrap items-center gap-1 border-b px-2"
    >
      <ToolButton
        icon={Play}
        label="全体再生"
        priority="high"
        onPress={() => waveControls()?.playAll()}
        shortcut="Space"
      />
      <ToolButton
        icon={SquarePlay}
        label="発声区間再生"
        priority="high"
        onPress={() => waveControls()?.playRange()}
        shortcut="Ctrl+Space"
      />
      <ToolButton
        icon={Square}
        label="停止"
        priority="high"
        onPress={() => waveControls()?.stop()}
        shortcut="Esc"
      />
      <ToolButton
        icon={Metronome}
        label="発声タイミング試聴"
        onPress={() => {
          void playTiming();
        }}
        shortcut="F8"
      />
      {divider}
      <ToolButton
        icon={ZoomOut}
        iconOnly
        label="縮小"
        onPress={() => waveControls()?.zoom(1 / 1.5)}
        shortcut="F11"
      />
      <ToolButton
        icon={ZoomIn}
        iconOnly
        label="拡大"
        onPress={() => waveControls()?.zoom(1.5)}
        shortcut="F12"
      />
      <ToolButton
        icon={FoldHorizontal}
        label="波形全体を表示"
        onPress={() => waveControls()?.fit()}
      />
      {divider}
      {MARKERS.map((marker) => {
        const text = `${MARKER_LABELS[marker]}をカーソル位置へ配置（${MARKER_KEYS[marker]}）`;
        return (
          <Tip key={marker} text={text}>
            <Button
              aria-label={text}
              className="px-1.5 font-mono text-[11px]"
              onPress={() => waveControls()?.placeMarker(marker)}
              tone="ghost"
            >
              <ParamSwatch param={marker} />
              {MARKER_KEYS[marker]}
            </Button>
          </Tip>
        );
      })}
      <ToolToggle
        icon={Link2}
        isSelected={settings.preutterMode === "relative"}
        label="先行発声連動"
        onChange={(on) => {
          updateSettings({ preutterMode: on ? "relative" : "independent" });
        }}
      />
    </AriaToolbar>
  );
};
