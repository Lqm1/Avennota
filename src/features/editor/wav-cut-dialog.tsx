import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { MsField } from "../../components/ui/field";
import { processWavs } from "./file-tools";
import { closeEditorPanel } from "./settings";
import { ask, editorStore } from "./store";

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
        title: "カット範囲の確認",
        message:
          "左右ブランクよりも長くカットされる原音設定行があります。設定値の位置関係が崩れる可能性がありますが、続行しますか？",
        actions: [
          { id: "continue", label: "続行" },
          { id: "cancel", label: "キャンセル" },
        ],
      })) !== "continue"
    ) {
      return;
    }
    closeEditorPanel();
    await processWavs([...workspace.session.wavs.values()], {
      dc: false,
      mono: false,
      headMs: head * 1000,
      tailMs: tail * 1000,
      adjustBlanks: adjust,
    });
  };
  return (
    <EditorDialog title="WAVの両端を一括カット" onClose={closeEditorPanel}>
      <div className="flex flex-col gap-3">
        <MsField
          label="先頭からのカット長（秒）"
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
          label="カット後に左右ブランクを自動補正（原音設定の絶対位置を維持）"
          value={adjust}
          onChange={setAdjust}
        />
        <p className="text-xs text-slate-400">
          左右ブランク長を超えてカットした場合、設定位置がずれることがあります。
        </p>
        <div className="flex justify-end gap-2">
          <Button onPress={closeEditorPanel}>キャンセル</Button>
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
