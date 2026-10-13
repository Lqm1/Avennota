import { useState } from "react";

import { Button } from "../../components/ui/button";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { MsField } from "../../components/ui/field";
import { closeEditorPanel, updateSettings, useSettings } from "./settings";

export const ViewDialog = ({ mode }: { mode: "bpm" | "opacity" }) => {
  const settings = useSettings();
  const [bpm, setBpm] = useState(settings.bpm);
  const [offset, setOffset] = useState(settings.bpmOffset);
  const [opacity, setOpacity] = useState(settings.advanced.opacity);
  return (
    <EditorDialog
      title={
        mode === "bpm"
          ? "時間軸のBPMと開始位置"
          : "ウィンドウの透過（Windowsのみ）"
      }
      onClose={closeEditorPanel}
    >
      <div className="flex flex-col gap-3">
        {mode === "bpm" ? (
          <>
            <MsField label="BPM" value={bpm} swatch={null} onCommit={setBpm} />
            <MsField
              label="グリッド開始位置（秒）"
              value={offset}
              swatch={null}
              onCommit={setOffset}
            />
          </>
        ) : (
          <MsField
            label="ウィンドウの不透明度（0.2〜1.0）"
            value={opacity}
            swatch={null}
            onCommit={setOpacity}
          />
        )}
        <div className="flex justify-end gap-2">
          <Button onPress={closeEditorPanel}>キャンセル</Button>
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
              closeEditorPanel();
            }}
          >
            OK
          </Button>
        </div>
      </div>
    </EditorDialog>
  );
};
