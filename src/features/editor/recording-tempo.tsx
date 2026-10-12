import { useEffect, useState } from "react";

import { Button } from "../../components/ui/button";
import { MsField } from "../../components/ui/field";
import type { VoiceFolder } from "../../platform/files/types";
import { inferRecordings } from "../alignment/client";
import { loadJapaneseModel } from "../alignment/models";
import { readRecordingTranscripts } from "../alignment/recordings";
import {
  estimateRecordingTempo,
  selectTempoRecordings,
} from "../alignment/tempo";
import type { TempoEstimate } from "../alignment/tempo";
import type { AcousticModel } from "../alignment/types";
import { errorText } from "./store";

export interface RecordingTempo {
  kind: "default" | "estimating" | "estimated" | "manual";
  bpm: number;
}
type EstimationState =
  | { kind: "loading"; message: string }
  | TempoEstimate
  | { kind: "error"; message: string };

export const RecordingTempoField = ({
  folder,
  wavs,
  index,
  transcripts,
  filenameSuffix,
  model,
  value,
  onChange,
  isDisabled,
}: {
  folder: VoiceFolder;
  wavs: string[];
  index: ReadonlyMap<string, string[]>;
  transcripts: ReadonlyMap<string, string>;
  filenameSuffix: string;
  model: AcousticModel | null;
  value: RecordingTempo;
  onChange: React.Dispatch<React.SetStateAction<RecordingTempo>>;
  isDisabled: boolean;
}) => {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<EstimationState>({
    kind: "loading",
    message: "収録BPMを推定しています…",
  });
  useEffect(() => {
    const controller = new AbortController();
    const estimate = async () => {
      try {
        setState({
          kind: "loading",
          message:
            retry === 0
              ? "収録BPMを推定しています…"
              : "収録BPMを再推定しています…",
        });
        onChange((previous) =>
          previous.kind === "manual"
            ? previous
            : { kind: "estimating", bpm: 120 }
        );
        const recordings = await readRecordingTranscripts({
          folder,
          wavs,
          index,
          transcripts,
          filenameSuffix,
        });
        controller.signal.throwIfAborted();
        const samples = selectTempoRecordings(recordings);
        let result: TempoEstimate = { kind: "unavailable" };
        if (samples.length > 0) {
          const acousticModel =
            model ?? (await loadJapaneseModel(controller.signal));
          const aligned = await inferRecordings({
            folder,
            model: acousticModel,
            recordings: samples,
            format: "vcv",
            signal: controller.signal,
            adapt: false,
            onProgress: () => {
              controller.signal.throwIfAborted();
            },
            onTrainingProgress: () => {
              controller.signal.throwIfAborted();
            },
          });
          result = estimateRecordingTempo(aligned);
        }
        controller.signal.throwIfAborted();
        setState(result);
        if (result.kind === "estimated") {
          const { bpm } = result;
          onChange((previous) =>
            previous.kind === "manual" ? previous : { kind: "estimated", bpm }
          );
        } else {
          onChange((previous) =>
            previous.kind === "manual"
              ? previous
              : { kind: "default", bpm: 120 }
          );
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({ kind: "error", message: errorText(error) });
          onChange((previous) =>
            previous.kind === "manual"
              ? previous
              : { kind: "default", bpm: 120 }
          );
        }
      }
    };
    void estimate();

    return () => {
      controller.abort();
    };
  }, [
    folder,
    wavs,
    index,
    transcripts,
    filenameSuffix,
    model,
    retry,
    onChange,
  ]);

  return (
    <div className="flex flex-col gap-2">
      <MsField
        label="収録BPM"
        value={value.bpm}
        onCommit={(bpm) => {
          onChange({ kind: "manual", bpm });
        }}
        swatch={null}
        isDisabled={isDisabled}
      />
      <output className="text-xs text-slate-400">
        {value.kind === "manual" ? "手入力のBPMを使用します。" : null}
        {state.kind === "loading" ? state.message : null}
        {state.kind === "estimated"
          ? `推定値: ${state.bpm} BPM（${state.recordings}録音）。手入力で変更できます。`
          : null}
        {state.kind === "unavailable"
          ? "収録BPMを推定できません。ガイドBGMのBPMを入力してください（初期値120）。"
          : null}
        {state.kind === "error"
          ? `BPM推定に失敗しました: ${state.message} 手入力で指定できます。`
          : null}
      </output>
      <div className="flex gap-2">
        <Button
          isDisabled={isDisabled || state.kind === "loading"}
          onPress={() => {
            setRetry(retry + 1);
          }}
        >
          BPMを再推定
        </Button>
        {state.kind === "estimated" && value.kind === "manual" ? (
          <Button
            isDisabled={isDisabled}
            onPress={() => {
              onChange({ kind: "estimated", bpm: state.bpm });
            }}
          >
            推定値を使う
          </Button>
        ) : null}
      </div>
    </div>
  );
};
