import { useState } from "react";

import { Button } from "../../components/ui/button";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { tonePlayback } from "../audio/tone-player";
import { SettingsForm } from "./settings-dialog";
import type { SettingsSection } from "./settings-dialog";

const sections: { id: SettingsSection; label: string }[] = [
  { id: "inputSettings", label: "操作" },
  { id: "settings", label: "詳細設定" },
  { id: "timingSettings", label: "発声タイミング" },
  { id: "playRangeSettings", label: "指定範囲再生" },
  { id: "focusSettings", label: "フォーカス" },
  { id: "nextSettings", label: "次のエントリへ移動" },
];

export const StartOptionsDialog = ({ onClose }: { onClose: () => void }) => {
  const [section, setSection] = useState<SettingsSection>("inputSettings");
  const close = () => {
    tonePlayback.stop();
    onClose();
  };
  return (
    <EditorDialog title="オプション" onClose={close}>
      <fieldset className="mb-5 flex flex-wrap gap-2" aria-label="設定の分類">
        {sections.map(({ id, label }) => (
          <Button
            key={id}
            aria-pressed={section === id}
            tone={section === id ? "primary" : "default"}
            onPress={() => {
              setSection(id);
            }}
          >
            {label}
          </Button>
        ))}
      </fieldset>
      <SettingsForm mode={section} onClose={close} liveUpdates={false} />
    </EditorDialog>
  );
};
