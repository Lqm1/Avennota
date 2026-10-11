import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "avennota.editor-settings";
class SettingsWindow extends EventTarget {
  readonly values = new Map<string, string>();
  failWrites = false;
  readonly localStorage = {
    getItem: (key: string) => this.values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (this.failWrites) {
        throw new DOMException("容量不足", "QuotaExceededError");
      }
      this.values.set(key, value);
    },
    removeItem: (key: string) => {
      this.values.delete(key);
    },
  };
}

describe("設定の保存", () => {
  let window: SettingsWindow;
  beforeEach(() => {
    vi.resetModules();
    window = new SettingsWindow();
    vi.stubGlobal("window", window);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("自動保存OFFの変更は再起動で戻り、明示保存した変更だけ残る", async () => {
    const settings = await import("./settings");
    await settings.persistSettings();
    const saved = window.values.get(KEY);
    settings.updateSettings({
      advanced: {
        ...settings.settingsStore.state.advanced,
        autoSaveSettings: false,
      },
    });
    settings.updateSettings({ showSpec: true });
    expect(settings.settingsStore.state.showSpec).toBeTruthy();
    expect(window.values.get(KEY)).toBe(saved);
    vi.resetModules();
    const reopened = await import("./settings");
    expect(reopened.settingsStore.state.showSpec).toBeFalsy();
    await settings.persistSettings();
    vi.resetModules();
    const manuallySaved = await import("./settings");
    expect(manuallySaved.settingsStore.state.showSpec).toBeTruthy();
    expect(
      manuallySaved.settingsStore.state.advanced.autoSaveSettings
    ).toBeFalsy();
  });

  it("自動保存ONなら操作直後に保存し、連続した変更も読み戻せる", async () => {
    const settings = await import("./settings");
    settings.updateSettings({ showSpec: true });
    settings.updateSettings({ waveHeight: 160 });
    await vi.waitFor(() => {
      expect(window.values.get(KEY)).toContain('"waveHeight":160');
    });
    vi.resetModules();
    const reopened = await import("./settings");
    expect(reopened.settingsStore.state).toMatchObject({
      showSpec: true,
      waveHeight: 160,
    });
  });

  it("保存失敗でも適用値と以前の保存内容を保持し、再試行できる", async () => {
    const settings = await import("./settings");
    await settings.persistSettings();
    const saved = window.values.get(KEY);
    window.failWrites = true;
    settings.updateSettings({ showSpec: true });
    await settings.persistSettings();
    expect(settings.settingsStore.state.showSpec).toBeTruthy();
    expect(window.values.get(KEY)).toBe(saved);
    expect(settings.settingsErrorStore.state).toContain("設定を保存できません");
    window.failWrites = false;
    await settings.persistSettings();
    expect(settings.settingsErrorStore.state).toBe("");
    vi.resetModules();
    const reopened = await import("./settings");
    expect(reopened.settingsStore.state.showSpec).toBeTruthy();
  });
});
