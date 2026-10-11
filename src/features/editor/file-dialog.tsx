import { useEffect, useState } from "react";

import { Button } from "../../components/ui/button";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { CommitTextField, SelectField } from "../../components/ui/field";
import { getFilePlatform } from "../../platform/files";
import type { VoiceFolder } from "../../platform/files";
import { showEditorPanel } from "./settings";
import { openFolder, openIni, saveAs, useEditor, notify } from "./store";

const close = () => {
  showEditorPanel(null);
};

export const FileDialog = ({ mode }: { mode: "open" | "save" }) => {
  const [destination, setDestination] = useState<VoiceFolder | undefined>();
  const workspace = useEditor((state) => state.workspace);
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState(
    workspace.kind === "open" ? workspace.session.otoName : "oto.ini"
  );
  const folder = workspace.kind === "open" ? workspace.session.folder : null;
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (folder === null) {
        return;
      }
      try {
        const files = await folder.listFiles();
        if (!cancelled) {
          setNames(files.filter((file) => file.toLowerCase().endsWith(".ini")));
        }
      } catch (error) {
        if (!cancelled) {
          notify("error", String(error));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [folder]);
  const chooseDestination = async () => {
    try {
      const platform = await getFilePlatform();
      const picked = await platform.pickFolder();
      if (picked !== null) {
        setDestination(picked);
      }
    } catch (error) {
      notify("error", String(error));
    }
  };
  const run = async () => {
    const success = await (mode === "open"
      ? openIni(name)
      : saveAs(name, destination));
    if (success) {
      close();
    }
  };
  return (
    <EditorDialog
      title={
        mode === "open"
          ? "原音パラメータの読み込み"
          : "名前を付けて保存（Ctrl+Shift+S）"
      }
      onClose={close}
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-slate-400">
          {workspace.kind === "open"
            ? (destination?.name ??
              (workspace.session.storageFolder ?? workspace.session.folder)
                .name)
            : "音源フォルダを選んでください。"}
        </p>
        <Button
          onPress={() => {
            if (mode === "save") {
              void chooseDestination();
            } else {
              void openFolder();
            }
          }}
        >
          {mode === "save" ? "保存先フォルダを選ぶ" : "音源フォルダを選ぶ"}
        </Button>
        {mode === "open" ? (
          <SelectField
            label="iniファイル"
            value={name}
            options={names.map((id) => ({ id, label: id }))}
            onChange={setName}
          />
        ) : (
          <CommitTextField label="ファイル名" value={name} onCommit={setName} />
        )}
        <div className="flex justify-end gap-2">
          <Button onPress={close}>キャンセル</Button>
          <Button
            isDisabled={workspace.kind === "closed" || name === ""}
            tone="primary"
            onPress={() => {
              void run();
            }}
          >
            {mode === "open" ? "開く" : "保存"}
          </Button>
        </div>
      </div>
    </EditorDialog>
  );
};
