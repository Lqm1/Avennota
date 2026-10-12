import { useState } from "react";

import { Button } from "../../components/ui/button";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { MsField } from "../../components/ui/field";
import { showEditorPanel, updateSettings, useSettings } from "./settings";

const close = () => {
  showEditorPanel(null);
};

export const ViewDialog = ({ mode }: { mode: "bpm" | "opacity" }) => {
  const settings = useSettings();
  const [bpm, setBpm] = useState(settings.bpm);
  const [offset, setOffset] = useState(settings.bpmOffset);
  const [opacity, setOpacity] = useState(settings.advanced.opacity);
  return (
    <EditorDialog
      title={mode === "bpm" ? "時間軸のBPM" : "画面の透過（Windowsのみ）"}
      onClose={close}
    >
      <div className="flex flex-col gap-3">
        {mode === "bpm" ? (
          <>
            <MsField label="BPM" value={bpm} swatch={null} onCommit={setBpm} />
            <MsField
              label="開始位置（秒）"
              value={offset}
              swatch={null}
              onCommit={setOffset}
            />
          </>
        ) : (
          <MsField
            label="ウィンドウの不透明度（0.2〜1）"
            value={opacity}
            swatch={null}
            onCommit={setOpacity}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button onPress={close}>キャンセル</Button>
          <Button
            tone="primary"
            isDisabled={
              mode === "bpm"
                ? bpm <= 0 || bpm > 1000
                : opacity < 0.2 || opacity > 1
            }
            onPress={() => {
              if (mode === "bpm") {
                updateSettings({ bpm, bpmOffset: offset });
              } else {
                updateSettings({ advanced: { ...settings.advanced, opacity } });
              }
              close();
            }}
          >
            OK
          </Button>
        </div>
      </div>
    </EditorDialog>
  );
};
