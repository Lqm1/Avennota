import { useState } from "react";

import { Button } from "../../components/ui/button";
import type { VoiceFolder } from "../../platform/files/types";
import { saveLabels } from "../alignment/label-export";
import type { LabelRecording } from "../alignment/label-export";
import { errorText, notify } from "./store";

export const LabelExport = ({
  recordings,
  folder,
}: {
  recordings: LabelRecording[];
  folder: VoiceFolder;
}) => {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const save = async () => {
    if (exporting) {
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      await saveLabels(folder, recordings);
      notify(
        "info",
        `${recordings.length}件の音素ラベル（.lab）を音源フォルダに書き出しました。`
      );
    } catch (error) {
      setExportError(errorText(error));
    }
    setExporting(false);
  };
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-slate-400">
        音素ラベルの書き出し
      </h3>
      <div className="border-line flex items-center gap-3 rounded border px-3 py-2">
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-slate-400">
          推定された音素境界を、各WAVファイルと同名のHTK単音素ラベル（.lab /
          100ns単位）として音源フォルダに書き出します（テンポ補正等は含まれません）。既存の
          .lab ファイルは .lab.bak に退避されます。
        </p>
        <Button
          isPending={exporting}
          onPress={() => {
            void save();
          }}
        >
          {exporting ? "書き出し中…" : "音素ラベル（.lab）を書き出す"}
        </Button>
      </div>
      {exportError === null ? null : (
        <p role="alert" className="text-xs text-red-300">
          {exportError}
        </p>
      )}
    </section>
  );
};
