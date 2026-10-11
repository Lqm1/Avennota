import { useEffect, useState } from "react";

import { Button } from "../../components/ui/button";
import { unsupportedReason } from "../../platform/files";
import { RecentFoldersDialog } from "./recent-folders-dialog";
import { StartOptionsDialog } from "./start-options-dialog";
import {
  discardRecovery,
  openFolder,
  refreshRecoveries,
  restoreRecovery,
  useEditor,
} from "./store";

const formatTime = (time: number): string =>
  new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(time);

export const StartScreen = () => {
  const [dialog, setDialog] = useState<"recent" | "options" | null>(null);
  const records = useEditor((state) => state.recoveries);
  const reason = unsupportedReason();

  useEffect(() => {
    if (reason === null) {
      void refreshRecoveries();
    }
  }, [reason]);

  return (
    <div className="flex h-full overflow-auto p-6">
      {/* items-centerでは画面より高い内容の上端が切れるため、m-autoで中央に置く。 */}
      <div className="m-auto flex w-full max-w-xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Avennota</h1>
          <p className="mt-1 text-sm text-slate-400">
            UTAU音源のフォルダを開き、oto.iniの原音設定を編集します。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onPress={() => {
                setDialog("recent");
              }}
            >
              最近使ったフォルダ
            </Button>
            <Button
              onPress={() => {
                setDialog("options");
              }}
            >
              オプション
            </Button>
          </div>
        </div>
        {reason === null ? (
          <Button
            className="h-10 self-start px-5 text-sm"
            onPress={() => {
              void openFolder();
            }}
            tone="primary"
          >
            音源フォルダを開く（Ctrl+O）
          </Button>
        ) : (
          <p className="rounded border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
            {reason}
          </p>
        )}
        {records.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-slate-200">
              未保存の編集が残っています
            </h2>
            <ul className="flex flex-col gap-2">
              {records.map((record) => (
                <li
                  className="border-line bg-panel flex items-center gap-3 rounded border p-3"
                  key={record.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-100">
                      {record.folderName}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formatTime(record.savedAt)}に記録
                    </div>
                  </div>
                  <Button
                    onPress={() => {
                      void restoreRecovery(record.id);
                    }}
                    tone="primary"
                  >
                    復元
                  </Button>
                  <Button
                    onPress={() => {
                      void discardRecovery(record.id);
                    }}
                    tone="ghost"
                  >
                    破棄
                  </Button>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-500">
              復元するまで元のoto.iniは変わりません。ブラウザのサイトデータを削除した場合、この記録は失われます。
            </p>
          </section>
        ) : null}
      </div>
      {dialog === "recent" ? (
        <RecentFoldersDialog
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === "options" ? (
        <StartOptionsDialog
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
};
