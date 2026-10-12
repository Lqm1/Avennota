import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../../components/ui/button";
import { MsField } from "../../components/ui/field";
import { Tip } from "../../components/ui/tool-button";
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

const unavailableMessages = {
  recordings:
    "テンポ推定に適した録音（休符や促音を含まない5モーラ以上の連続発声）がありません。",
  boundaries: "音声から十分な発声間隔を検出できませんでした。",
  agreement: "録音ごとのテンポ推定値にばらつきがあるため特定できませんでした。",
};

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
    message: "収録BPMを推定中…",
  });
  useEffect(() => {
    const controller = new AbortController();
    const unlessManual = (next: RecordingTempo) => {
      onChange((previous) => (previous.kind === "manual" ? previous : next));
    };
    const estimate = async () => {
      try {
        setState({
          kind: "loading",
          message: retry === 0 ? "収録BPMを推定中…" : "収録BPMを再推定中…",
        });
        unlessManual({ kind: "estimating", bpm: 120 });
        const recordings = await readRecordingTranscripts({
          folder,
          wavs,
          index,
          transcripts,
          filenameSuffix,
        });
        controller.signal.throwIfAborted();
        const samples = selectTempoRecordings(recordings);
        let result: TempoEstimate = {
          kind: "unavailable",
          reason: "recordings",
        };
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
          unlessManual({ kind: "estimated", bpm: result.bpm });
        } else {
          unlessManual({ kind: "default", bpm: 120 });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({ kind: "error", message: errorText(error) });
          unlessManual({ kind: "default", bpm: 120 });
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

  let status = "";
  if (state.kind === "loading") {
    status = state.message;
  } else if (value.kind === "manual") {
    status = "手入力された値を使用中";
  } else if (state.kind === "estimated") {
    status = `自動推定された値です（${state.recordings}件の録音から算出）`;
  } else if (state.kind === "unavailable") {
    status = `${unavailableMessages[state.reason]}（既定値 120 を適用中）`;
  } else {
    status = `収録BPMの推定に失敗しました: ${state.message}`;
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-end gap-1">
        <div className="min-w-0 flex-1">
          <MsField
            label="収録BPM"
            value={value.bpm}
            onCommit={(bpm) => {
              onChange({ kind: "manual", bpm });
            }}
            swatch={null}
            isDisabled={isDisabled}
          />
        </div>
        <Tip text="収録BPMを再推定">
          <Button
            aria-label="収録BPMを再推定"
            tone="ghost"
            isDisabled={isDisabled || state.kind === "loading"}
            onPress={() => {
              setRetry(retry + 1);
            }}
          >
            <RefreshCw
              className={
                state.kind === "loading" ? "size-3.5 animate-spin" : "size-3.5"
              }
            />
          </Button>
        </Tip>
      </div>
      <output
        className={
          state.kind === "error" || state.kind === "unavailable"
            ? "text-[11px] text-amber-300"
            : "text-[11px] text-slate-400"
        }
      >
        {status}
      </output>
      {state.kind === "estimated" && value.kind === "manual" ? (
        <Button
          className="self-start"
          tone="ghost"
          isDisabled={isDisabled}
          onPress={() => {
            onChange({ kind: "estimated", bpm: state.bpm });
          }}
        >
          推定値（{state.bpm}）に戻す
        </Button>
      ) : null}
    </div>
  );
};
