import { exportDocument, pickDocument } from "../../platform/files/documents";
import {
  advancedSettingsSchema,
  advancedSettingsFieldsSchema,
} from "./advanced-settings";
import type { AdvancedSettings } from "./advanced-settings";
import { settingsSchema } from "./settings";
import type { EditorSettings } from "./settings";
import { notify } from "./store";

export const settingsFile = async (
  mode: "read" | "write",
  section: "all" | "appearance" | "analysis",
  draft: EditorSettings,
  onChange: (draft: EditorSettings) => void | Promise<void>
) => {
  const { advanced } = draft;
  try {
    const keys: (keyof AdvancedSettings)[] =
      section === "appearance"
        ? ["colors", "fontFamily", "fontSize", "alwaysOnTop", "opacity"]
        : [
            "sampleRate",
            "brightness",
            "contrast",
            "windowLength",
            "window",
            "preEmphasis",
            "powerStep",
            "powerWindow",
            "powerPreEmphasis",
            "powerWindowKind",
            "pitchStep",
            "pitchWindow",
            "pitchMin",
            "pitchMax",
            "pitchMethod",
            "pitchUnit",
            "pitchFixedRange",
            "pitchDisplayMin",
            "pitchDisplayMax",
            "toneGrid",
            "targetPitch",
            "showTargetPitch",
          ];
    if (mode === "write") {
      const data =
        section === "all"
          ? draft
          : {
              advanced: Object.fromEntries(
                keys.map((key) => [key, advanced[key]])
              ),
            };
      await exportDocument(
        "avennota-settings.json",
        new TextEncoder().encode(JSON.stringify(data, null, 2))
      );
      return;
    }
    const picked = await pickDocument(["json"]);
    if (picked === null) {
      return;
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(picked.bytes));
    if (section === "all") {
      await onChange(settingsSchema.parse(parsed));
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("advanced" in parsed) ||
      typeof parsed.advanced !== "object" ||
      parsed.advanced === null
    ) {
      throw new Error("設定ファイルの形式が不正です。");
    }
    const imported = advancedSettingsFieldsSchema
      .partial()
      .parse(parsed.advanced);
    const patch = Object.fromEntries(
      keys
        .filter((key) => imported[key] !== undefined)
        .map((key) => [key, imported[key]])
    );
    await onChange({
      ...draft,
      advanced: advancedSettingsSchema.parse({ ...advanced, ...patch }),
    });
  } catch (error) {
    notify("error", `設定ファイルを操作できません: ${String(error)}`);
  }
};
