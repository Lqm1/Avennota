import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { MsField } from "../../components/ui/field";
import { processWavs } from "./file-tools";
import { showEditorPanel } from "./settings";
import { ask, editorStore } from "./store";

const close = () => {
  showEditorPanel(null);
};

export const WavCutDialog = () => {
  const [head, setHead] = useState(0);
  const [tail, setTail] = useState(0);
  const [adjust, setAdjust] = useState(true);
  const run = async () => {
    const { workspace } = editorStore.state;
    if (workspace.kind === "closed") {
      return;
    }
    const unsafe = workspace.history.present.otoSet.lines.some(
      (line) =>
        line.parsed.kind === "oto" &&
        (line.parsed.oto.offset < head * 1000 ||
          (line.parsed.oto.cutoff >= 0 && line.parsed.oto.cutoff < tail * 1000))
    );
    if (
      adjust &&
      unsafe &&
      (await ask({
        title: "ブランクより長いカット",
        message:
          "左右ブランク値より長くカットされる行があります。パラメータ位置がずれる可能性があります。続行しますか？",
        actions: [
          { id: "continue", label: "続行" },
          { id: "cancel", label: "キャンセル" },
        ],
      })) !== "continue"
    ) {
      return;
    }
    close();
    await processWavs([...workspace.session.wavs.values()], {
      dc: false,
      mono: false,
      headMs: head * 1000,
      tailMs: tail * 1000,
      adjustBlanks: adjust,
    });
  };
  return (
    <EditorDialog title="wavの両端をカット" onClose={close}>
      <div className="flex flex-col gap-3">
        <MsField
          label="冒頭からのカット長（秒）"
          value={head}
          swatch={null}
          onCommit={setHead}
        />
        <MsField
          label="末尾からのカット長（秒）"
          value={tail}
          swatch={null}
          onCommit={setTail}
        />
        <Check
          label="カット後に左右ブランク値を補正してパラメータ位置がずれないようにする"
          value={adjust}
          onChange={setAdjust}
        />
        <p className="text-xs text-slate-400">
          ブランク値より長くカットした場合、位置がずれることがあります。
        </p>
        <div className="flex justify-end gap-2">
          <Button onPress={close}>キャンセル</Button>
          <Button
            tone="primary"
            isDisabled={head < 0 || tail < 0 || head + tail === 0}
            onPress={() => {
              void run();
            }}
          >
            実行
          </Button>
        </div>
      </div>
    </EditorDialog>
  );
};
