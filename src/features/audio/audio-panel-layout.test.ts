import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, settingsSchema } from "../editor/settings";
import { audioPanelLayout, resizePanelPair } from "./audio-panel-layout";

describe("音声パネルの表示領域", () => {
  it("全て非表示なら領域を確保しない", () => {
    expect(
      audioPanelLayout({ ...DEFAULT_SETTINGS, showWave: false }, 480)
    ).toStrictEqual([]);
  });

  it("間の非表示パネルを詰め、表示中のパネルで全高を使う", () => {
    const layout = audioPanelLayout(
      {
        ...DEFAULT_SETTINGS,
        advanced: { ...DEFAULT_SETTINGS.advanced, showPitch: true },
      },
      480
    );
    expect(layout).toStrictEqual([
      { panel: "waveHeight", weight: 100, top: 0, height: 200 },
      { panel: "pitchHeight", weight: 140, top: 200, height: 280 },
    ]);
  });

  it("単独表示は保存された高さに関係なく領域全体を使う", () => {
    expect(audioPanelLayout(DEFAULT_SETTINGS, 600)).toStrictEqual([
      { panel: "waveHeight", weight: 100, top: 0, height: 600 },
    ]);
  });

  it("境界の変更は隣接パネル間で高さを移し、合計高さと設定の有効性を保つ", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      showSpec: true,
      advanced: {
        ...DEFAULT_SETTINGS.advanced,
        showPower: true,
        showPitch: true,
      },
    };
    const layout = audioPanelLayout(settings, 480);
    const [, panel, next] = layout;
    if (panel === undefined || next === undefined) {
      throw new Error("Missing test panels");
    }
    const updated = {
      ...settings,
      ...resizePanelPair(settings, panel, next, panel.height + 20),
    };
    expect(settingsSchema.safeParse(updated).success).toBeTruthy();
    const resized = audioPanelLayout(updated, 480);
    expect(resized[0]?.height).toBeCloseTo(layout[0]?.height ?? 0);
    expect(resized[1]?.height).toBeCloseTo(panel.height + 20);
    expect(resized[2]?.height).toBeCloseTo(next.height - 20);
    expect(
      resized.reduce((height, size) => height + size.height, 0)
    ).toBeCloseTo(480);
    for (const height of [-10_000, 10_000]) {
      const clamped = {
        ...settings,
        ...resizePanelPair(settings, panel, next, height),
      };
      expect(settingsSchema.safeParse(clamped).success).toBeTruthy();
      expect(
        audioPanelLayout(clamped, 480).every((size) => size.height > 0)
      ).toBeTruthy();
    }
  });
});
