import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import type { EditorSettings } from "../editor/settings";

export type AudioPanel =
  | "waveHeight"
  | "specHeight"
  | "powerHeight"
  | "pitchHeight";
export interface AudioPanelSize {
  panel: AudioPanel;
  height: number;
  top: number;
  weight: number;
}

export const audioPanelLayout = (
  settings: EditorSettings,
  height: number
): AudioPanelSize[] => {
  const panels = [
    {
      panel: "waveHeight",
      visible: settings.showWave,
      weight: settings.waveHeight,
    },
    {
      panel: "specHeight",
      visible: settings.showSpec,
      weight: settings.specHeight,
    },
    {
      panel: "powerHeight",
      visible: settings.advanced.showPower,
      weight: settings.advanced.powerHeight,
    },
    {
      panel: "pitchHeight",
      visible: settings.advanced.showPitch,
      weight: settings.advanced.pitchHeight,
    },
  ] satisfies { panel: AudioPanel; visible: boolean; weight: number }[];
  const visible = panels.filter((panel) => panel.visible);
  const total = visible.reduce((sum, panel) => sum + panel.weight, 0);
  let top = 0;
  return visible.map(({ panel, weight }) => {
    const size = { panel, weight, top, height: (height * weight) / total };
    top += size.height;
    return size;
  });
};

export const panelResizeBounds = (
  panel: AudioPanelSize,
  next: AudioPanelSize
) => {
  const scale = panel.height / panel.weight;
  return {
    min: Math.max(50, panel.weight + next.weight - 2000) * scale,
    max: Math.min(2000, panel.weight + next.weight - 50) * scale,
  };
};

export const resizePanelPair = (
  settings: EditorSettings,
  panel: AudioPanelSize,
  next: AudioPanelSize,
  height: number
): Partial<EditorSettings> => {
  if (panel.height <= 0) {
    return {};
  }
  const bounds = panelResizeBounds(panel, next);
  const weight =
    (Math.min(bounds.max, Math.max(bounds.min, height)) * panel.weight) /
    panel.height;
  const changes: Partial<EditorSettings> = {};
  for (const [key, value] of [
    [panel.panel, weight],
    [next.panel, panel.weight + next.weight - weight],
  ] satisfies [AudioPanel, number][]) {
    if (key === "waveHeight" || key === "specHeight") {
      changes[key] = value;
    } else {
      changes.advanced = {
        ...(changes.advanced ?? settings.advanced),
        [key]: Math.round(value),
      };
    }
  }
  return changes;
};

export const useAudioPanelLayout = (
  hostRef: RefObject<HTMLElement | null>,
  settings: EditorSettings
) => {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const host = hostRef.current;
    const measure = () => {
      setHeight(host?.getBoundingClientRect().height ?? 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (host !== null) {
      observer.observe(host);
    }
    return () => {
      observer.disconnect();
    };
  }, [hostRef]);
  const layout = useMemo(
    () => audioPanelLayout(settings, height),
    [settings, height]
  );
  const latestLayout = useRef(layout);
  useLayoutEffect(() => {
    latestLayout.current = layout;
  }, [layout]);
  const panelHeight = (panel: AudioPanel) =>
    layout.find((size) => size.panel === panel)?.height ?? 0;
  return {
    layout,
    latestLayout,
    visibleWaveHeight: panelHeight("waveHeight"),
    spectrogramHeight: panelHeight("specHeight"),
    powerHeight: panelHeight("powerHeight"),
    pitchHeight: panelHeight("pitchHeight"),
  };
};
