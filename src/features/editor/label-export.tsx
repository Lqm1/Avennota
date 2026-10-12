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
        `${recordings.length}件のラベルを音源フォルダに保存しました。`
      );
    } catch (error) {
      setExportError(errorText(error));
    }
    setExporting(false);
  };
  return (
    <fieldset disabled={exporting} className="flex flex-col gap-2">
      <legend className="mb-2 text-sm text-slate-200">
        音素ラベルの書き出し
      </legend>
      <div className="flex items-end gap-2">
        <Button
          onPress={() => {
            void save();
          }}
          isDisabled={exporting}
        >
          {exporting ? "書き出し中" : "音源フォルダにラベルを保存"}
        </Button>
      </div>
      <p className="text-xs text-slate-400">
        SHIROの元の音素境界を前後の無音とともに出力します。BPMや原音設定用の補正は含みません。
        WAVと同名のHTK単音素ラベル（.lab）を音源フォルダに保存します。既存のラベルは.lab.bakに退避してから上書きします。時刻は100ns単位です。
        NNSVSの学習には別途、楽譜のフルコンテキストラベルが必要です。
      </p>
      {exportError === null ? null : (
        <p role="alert" className="text-xs text-red-300">
          {exportError}
        </p>
      )}
    </fieldset>
  );
};
