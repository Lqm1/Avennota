import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { ProgressBar } from "react-aria-components";

import { Button } from "../../components/ui/button";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { getFilePlatform } from "../../platform/files";
import {
  loadFolderHistory,
  reopenBookmark,
  useFolderHistory,
} from "./folder-history";
import type { FolderBookmark } from "./folder-history";
import { openVoiceFolder, confirmDiscardChanges, errorText } from "./store";

export const RecentFoldersDialog = ({ onClose }: { onClose: () => void }) => {
  const history = useFolderHistory();
  const [opening, setOpening] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    const load = async () => {
      try {
        await loadFolderHistory();
      } catch {
        setFailure("フォルダの履歴を読み込めませんでした。");
      }
    };
    void load();
  }, []);
  const open = async (entry: FolderBookmark) => {
    if (!(await confirmDiscardChanges("別のフォルダを開く"))) {
      return;
    }
    setOpening(entry.id);
    setFailure("");
    try {
      const folder = await reopenBookmark(entry);
      if (folder === null) {
        setFailure(
          "このフォルダにアクセスできません。音源フォルダを開くボタンから選び直してください。"
        );
      } else {
        await openVoiceFolder(folder, await getFilePlatform());
        onClose();
      }
    } catch (error) {
      setFailure(`フォルダを開けませんでした: ${errorText(error)}`);
    }
    setOpening(null);
  };
  return (
    <EditorDialog title="最近使ったフォルダ" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">
            最近使ったフォルダはありません。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((entry) => (
              <li key={entry.id}>
                <Button
                  className="h-auto w-full justify-between gap-3 px-3 py-3 text-left data-pending:bg-white/14"
                  isDisabled={opening !== null && opening !== entry.id}
                  isPending={opening === entry.id}
                  onPress={() => {
                    void open(entry);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{entry.name}</span>
                    {entry.nativePath === null ? null : (
                      <span className="mt-1 block truncate text-xs font-normal text-slate-400">
                        {entry.nativePath}
                      </span>
                    )}
                  </span>
                  {opening === entry.id ? (
                    <ProgressBar aria-label="開いています" isIndeterminate>
                      <LoaderCircle className="text-accent size-4 animate-spin" />
                    </ProgressBar>
                  ) : null}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {failure === "" ? null : (
          <p role="alert" className="text-sm text-amber-300">
            {failure}
          </p>
        )}
        <div className="border-line flex justify-end border-t pt-3">
          <Button onPress={onClose}>閉じる</Button>
        </div>
      </div>
    </EditorDialog>
  );
};
