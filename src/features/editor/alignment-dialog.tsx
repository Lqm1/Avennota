import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import { EditorDialog } from "../../components/ui/editor-dialog";
import {
  CommitTextField,
  MsField,
  SelectField,
} from "../../components/ui/field";
import { pickDocument } from "../../platform/files/documents";
import { inferRecordings } from "../alignment/client";
import { transcriptionFromFilename } from "../alignment/japanese";
import { loadJapaneseModel, phoneInventory } from "../alignment/models";
import {
  applyOtoSuggestions,
  generateOtoSuggestions,
  readCvTimingTable,
} from "../alignment/oto-generation";
import type { CvTiming, VoicebankFormat } from "../alignment/oto-generation";
import {
  readRecordingIndex,
  recordingTranscript,
} from "../alignment/recordings";
import { regularizeRepeatedVowels } from "../alignment/rhythm";
import type { BoundaryCorrection } from "../alignment/rhythm";
import type { AcousticModel } from "../alignment/types";
import { decodeBytes, guessEncoding } from "../oto/encoding";
import type { OtoSet } from "../oto/oto-set";
import { formatNumber, PARAM_KEYS, PARAM_LABELS } from "../oto/oto-set";
import { showEditorPanel } from "./settings";
import {
  editorStore,
  errorText,
  notify,
  transformOtoSet,
  useEditor,
} from "./store";
import type { Session } from "./store";

type RunState =
  | { kind: "idle" }
  | { kind: "running"; message: string }
  | { kind: "error"; message: string }
  | {
      kind: "result";
      before: OtoSet;
      after: OtoSet;
      session: Session;
      count: number;
      corrections: BoundaryCorrection[];
      onsetCorrections: { wav: string; before: number; after: number }[];
    };

const formats = [
  { id: "cv", label: "単独音（CV）" },
  { id: "vcv", label: "連続音（VCV）" },
  { id: "cvvc", label: "CVVC" },
] satisfies { id: VoicebankFormat; label: string }[];
const modes = [
  { id: "update", label: "既存エイリアスの値を補正" },
  { id: "generate", label: "対象WAVの原音設定行を生成・置き換え" },
] satisfies { id: "generate" | "update"; label: string }[];
const textOf = (bytes: Uint8Array<ArrayBuffer>) =>
  decodeBytes(bytes, guessEncoding(bytes).encoding);
const PAGE_SIZE = 20;
const runInferenceTask = async (
  task: () => Promise<void>,
  onError: (error: unknown) => void,
  onFinish: () => void
) => {
  try {
    await task();
  } catch (error) {
    onError(error);
  } finally {
    onFinish();
  }
};

export const AlignmentDialog = () => {
  const workspace = useEditor((state) => state.workspace);
  const wavs = useMemo(
    () =>
      workspace.kind === "open"
        ? [...workspace.session.wavs.values()].toSorted((a, b) =>
            a.localeCompare(b, "ja")
          )
        : [],
    [workspace]
  );
  const [selected, setSelected] = useState(() => new Set(wavs));
  const [transcripts, setTranscripts] = useState(new Map<string, string>());
  const [index, setIndex] = useState(new Map<string, string[]>());
  const [format, setFormat] = useState<VoicebankFormat>("vcv");
  const [mode, setMode] = useState<"generate" | "update">(
    workspace.kind === "open" && workspace.session.baseline !== null
      ? "update"
      : "generate"
  );
  const [bpm, setBpm] = useState(120);
  const [adapt, setAdapt] = useState(true);
  const [suffix, setSuffix] = useState("");
  const [filenameSuffix, setFilenameSuffix] = useState("");
  const [limit, setLimit] = useState(1);
  const [cvTimings, setCvTimings] = useState(new Map<string, CvTiming>());
  const [customModel, setCustomModel] = useState<AcousticModel | null>(null);
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const [page, setPage] = useState(0);
  const active = useRef<AbortController | null>(null);
  const running = state.kind === "running";

  useEffect(
    () => () => {
      active.current?.abort();
    },
    []
  );
  const close = () => {
    active.current?.abort();
    showEditorPanel(null);
  };
  const readFile = async (kind: "index" | "timings" | "model") => {
    try {
      if (kind === "model") {
        const parameters = await pickDocument(["hsmm"]);
        if (!parameters) {
          return;
        }
        const phonemap = await pickDocument(["json"]);
        if (!phonemap) {
          return;
        }
        const mapText = textOf(phonemap.bytes);
        phoneInventory(mapText);
        setCustomModel({
          id: "custom",
          name: parameters.name,
          parameters: parameters.bytes.buffer,
          phonemap: mapText,
        });
      } else {
        const file = await pickDocument(["csv"]);
        if (!file) {
          return;
        }
        if (kind === "index") {
          setIndex(readRecordingIndex(textOf(file.bytes)));
        } else {
          setCvTimings(readCvTimingTable(textOf(file.bytes)));
        }
      }
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: errorText(error) });
    }
  };
  const run = async () => {
    const current = editorStore.state.workspace;
    if (
      current.kind !== "open" ||
      active.current !== null ||
      selected.size === 0
    ) {
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setState({ kind: "running", message: "発音列を確認しています" });
    await runInferenceTask(
      async () => {
        let recordingIndex = index;
        if (recordingIndex.size === 0) {
          const names = await current.session.folder.listFiles();
          const name = names.find(
            (entry) => entry.toLowerCase() === "index.csv"
          );
          if (name !== undefined) {
            recordingIndex = readRecordingIndex(
              textOf(await current.session.folder.read(name))
            );
          }
        }
        controller.signal.throwIfAborted();
        const priority = new Map(
          [...recordingIndex.keys()].map((name, at) => [name, at])
        );
        const recordings = wavs
          .filter((wav) => selected.has(wav))
          .toSorted(
            (a, b) =>
              (priority.get(a.toLocaleLowerCase("ja")) ??
                Number.MAX_SAFE_INTEGER) -
              (priority.get(b.toLocaleLowerCase("ja")) ??
                Number.MAX_SAFE_INTEGER)
          )
          .map((wav) =>
            recordingTranscript(
              wav,
              transcripts.get(wav) ??
                (recordingIndex.has(wav.toLocaleLowerCase("ja"))
                  ? undefined
                  : transcriptionFromFilename(wav, filenameSuffix)),
              recordingIndex.get(wav.toLocaleLowerCase("ja"))
            )
          );
        setState({
          kind: "running",
          message: "音響モデルを読み込んでいます（初回は取得します）",
        });
        const model =
          customModel ?? (await loadJapaneseModel(controller.signal));
        const aligned = await inferRecordings({
          folder: current.session.folder,
          model,
          recordings,
          format,
          signal: controller.signal,
          adapt,
          onTrainingProgress: (completed, total) => {
            if (!controller.signal.aborted) {
              setState({
                kind: "running",
                message: `音源にモデルを適合させています　${completed} / ${total}`,
              });
            }
          },
          onProgress: (completed, total, wav) => {
            if (!controller.signal.aborted) {
              setState({
                kind: "running",
                message: `${completed} / ${total} WAV　${wav}`,
              });
            }
          },
        });
        const adjusted = aligned.map((recording) =>
          format === "cv"
            ? { recording, corrections: [] }
            : regularizeRepeatedVowels(recording, bpm)
        );
        const suggestions = adjusted.flatMap(({ recording }) =>
          generateOtoSuggestions(recording, { format, bpm, suffix, cvTimings })
        );
        const before = current.history.present.otoSet;
        const after = applyOtoSuggestions(
          before,
          suggestions,
          mode,
          limit,
          suffix
        );
        controller.signal.throwIfAborted();
        setState({
          kind: "result",
          before,
          after,
          session: current.session,
          count: aligned.length,
          corrections: adjusted.flatMap((result) => result.corrections),
          onsetCorrections: aligned.flatMap((recording) => {
            const [, vowel] = recording.intervals;
            return recording.cvOnset && vowel
              ? [
                  {
                    wav: recording.wav,
                    before: vowel.start,
                    after: recording.cvOnset.voicingStart,
                  },
                ]
              : [];
          }),
        });
      },
      (error) => {
        if (!controller.signal.aborted) {
          setState({ kind: "error", message: errorText(error) });
        }
      },
      () => {
        if (active.current === controller) {
          active.current = null;
        }
      }
    );
  };
  const apply = () => {
    if (state.kind !== "result") {
      return;
    }
    const current = editorStore.state.workspace;
    if (
      current.kind !== "open" ||
      current.session !== state.session ||
      current.history.present.otoSet !== state.before
    ) {
      setState({
        kind: "error",
        message: "編集内容が変わりました。再度推定してください。",
      });
      return;
    }
    transformOtoSet(() => state.after);
    notify(
      "info",
      `${state.count}件のWAVの自動推定を反映しました。波形で確認し、必要なら修正して保存してください。Undoでまとめて戻せます。`
    );
    close();
  };
  const preview = useMemo(() => {
    if (state.kind !== "result") {
      return { changed: [], removed: [] };
    }
    const before = new Map(state.before.lines.map((line) => [line.id, line]));
    const after = new Set(state.after.lines.map((line) => line.id));
    return {
      changed: state.after.lines.filter(
        (line) => line.parsed.kind === "oto" && before.get(line.id) !== line
      ),
      removed: state.before.lines.filter(
        (line) => line.parsed.kind === "oto" && !after.has(line.id)
      ),
    };
  }, [state]);
  const resultLines = preview.changed;
  return (
    <EditorDialog title="原音設定の自動推定" onClose={close}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-slate-400">
          SHIROで発音の境界を推定します。結果を反映するまで編集内容は変わりません。音源ファイルへの書き込みは保存時に行います。
        </p>
        {state.kind === "result" ? (
          <>
            <output className="text-sm text-slate-200">
              {state.count} WAV、{resultLines.length}行の変更候補、
              {preview.removed.length}行の削除候補
            </output>
            {state.after === state.before ? (
              <p className="text-xs text-slate-300">
                {mode === "generate"
                  ? "推定が完了しました。現在の原音設定と推定結果は同じです。"
                  : "推定が完了しました。補正される行がありません。現在の数値が推定結果と同じか、補正対象のエイリアスが一致していません。"}
              </p>
            ) : null}
            {preview.removed.length > 0 ? (
              <details className="text-xs text-amber-200">
                <summary>
                  生成で置き換える既存行（{preview.removed.length}行）
                </summary>
                <ul className="mt-2 max-h-40 overflow-auto">
                  {preview.removed.slice(0, 100).map((line) =>
                    line.parsed.kind === "oto" ? (
                      <li key={line.id}>
                        {line.parsed.oto.wav}: {line.parsed.oto.alias}
                      </li>
                    ) : null
                  )}
                </ul>
                {preview.removed.length > 100 ? (
                  <p>先頭100行を表示しています。</p>
                ) : null}
              </details>
            ) : null}
            {state.onsetCorrections.length > 0 ? (
              <details className="text-xs text-amber-200">
                <summary>
                  単独音の母音開始を有声開始に合わせました（
                  {state.onsetCorrections.length} WAV）
                </summary>
                <ul className="mt-2 max-h-40 overflow-auto">
                  {state.onsetCorrections.map((correction) => (
                    <li key={correction.wav}>
                      {correction.wav}: {formatNumber(correction.before * 1000)}{" "}
                      → {formatNumber(correction.after * 1000)} ms
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {state.corrections.length > 0 ? (
              <details className="text-xs text-amber-200">
                <summary>
                  同一母音の境界をBPMで補正しました（{state.corrections.length}
                  箇所）
                </summary>
                <ul className="mt-2 max-h-40 overflow-auto">
                  {state.corrections.map((correction) => (
                    <li key={`${correction.wav}:${correction.before}`}>
                      {correction.wav}（{correction.phone}）:{" "}
                      {formatNumber(correction.before * 1000)} →{" "}
                      {formatNumber(correction.after * 1000)} ms
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-right text-xs tabular-nums">
                <caption className="sr-only">
                  自動推定結果（最初の100行）
                </caption>
                <thead>
                  <tr>
                    <th className="text-left">エイリアス</th>
                    {PARAM_KEYS.map((key) => (
                      <th key={key} className="p-1">
                        {PARAM_LABELS[key]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resultLines.slice(0, 100).map((line) =>
                    line.parsed.kind === "oto" ? (
                      <tr key={line.id}>
                        <th
                          className="p-1 text-left font-normal"
                          title={line.parsed.oto.wav}
                        >
                          {line.parsed.oto.alias}
                        </th>
                        {PARAM_KEYS.map((key) => (
                          <td key={key} className="p-1 font-mono">
                            {formatNumber(
                              line.parsed.kind === "oto"
                                ? line.parsed.oto[key]
                                : 0
                            )}
                          </td>
                        ))}
                      </tr>
                    ) : null
                  )}
                </tbody>
              </table>
            </div>
            {resultLines.length > 100 ? (
              <p className="text-xs text-slate-400">
                先頭100行を表示しています。反映後は一覧で全行を確認できます。
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                tone="primary"
                isDisabled={state.after === state.before}
                onPress={apply}
              >
                反映して波形で確認
              </Button>
              <Button
                onPress={() => {
                  setState({ kind: "idle" });
                }}
              >
                設定へ戻る
              </Button>
              <Button onPress={close}>破棄して閉じる</Button>
            </div>
          </>
        ) : (
          <>
            <fieldset disabled={running} className="flex flex-col gap-4">
              <legend className="sr-only">自動推定の設定</legend>
              <Check
                label="対象音源に合わせてモデルを学習する"
                value={adapt}
                onChange={setAdapt}
              />
              <p className="text-xs text-slate-400">
                学習後に境界を再推定します。多様な発音の録音を選んでください。少数の録音では精度が下がる場合があります。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  label="音源形式"
                  value={format}
                  options={formats}
                  onChange={setFormat}
                />
                <SelectField
                  label="反映方法"
                  value={mode}
                  options={modes}
                  onChange={setMode}
                />
                <MsField
                  label="収録BPM（連続音の調整）"
                  value={bpm}
                  onCommit={setBpm}
                  swatch={null}
                />
                <MsField
                  label="重複エイリアスの上限（0＝無制限）"
                  value={limit}
                  onCommit={(value) => {
                    setLimit(Math.max(0, Math.trunc(value)));
                  }}
                  swatch={null}
                  isDisabled={mode === "update"}
                />
                <CommitTextField
                  label="WAV名から除く接尾辞"
                  value={filenameSuffix}
                  onCommit={setFilenameSuffix}
                />
                <CommitTextField
                  label="エイリアスの接尾辞"
                  value={suffix}
                  onCommit={setSuffix}
                />
              </div>
              <p className="text-xs text-slate-400">
                生成では対象WAVの既存行を置き換えます。補正では一致した行の数値だけを変え、名前・コメント・行順を保ちます。
                連続音とCVVCでは、同一母音の極端に短い分割を収録BPMで補います。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  onPress={() => {
                    void readFile("index");
                  }}
                >
                  index.csvを読み込む
                </Button>
                <Button
                  onPress={() => {
                    void readFile("timings");
                  }}
                >
                  table.csvを読み込む
                </Button>
                <Button
                  onPress={() => {
                    void readFile("model");
                  }}
                >
                  別のモデル・phonemapを選ぶ
                </Button>
              </div>
              <p className="text-xs text-slate-400">
                {customModel?.name ??
                  "Intunist 日本語歌唱モデル（初回取得後はオフラインで利用）"}
                。低い男声では推定精度が下がる場合があります。table.csv:{" "}
                {cvTimings.size}音、index.csv: {index.size} WAV。
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-300">
                  対象 {selected.size} / {wavs.length} WAV
                </span>
                <Button
                  onPress={() => {
                    setSelected(new Set(wavs));
                  }}
                >
                  すべて選択
                </Button>
                <Button
                  onPress={() => {
                    setSelected(new Set());
                  }}
                >
                  選択を解除
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {wavs
                  .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                  .map((wav) => (
                    <div
                      key={wav}
                      className="grid grid-cols-2 items-center gap-3"
                    >
                      <Check
                        label={wav}
                        value={selected.has(wav)}
                        onChange={(value) => {
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (value) {
                              next.add(wav);
                            } else {
                              next.delete(wav);
                            }
                            return next;
                          });
                        }}
                      />
                      <CommitTextField
                        label={`${wav}の発音列（仮名）`}
                        hideLabel
                        value={
                          transcripts.get(wav) ??
                          transcriptionFromFilename(wav, filenameSuffix)
                        }
                        onCommit={(value) => {
                          setTranscripts((previous) =>
                            new Map(previous).set(wav, value)
                          );
                        }}
                      />
                    </div>
                  ))}
              </div>
              {wavs.length > PAGE_SIZE ? (
                <div className="flex items-center gap-2">
                  <Button
                    isDisabled={page === 0}
                    onPress={() => {
                      setPage(page - 1);
                    }}
                  >
                    前へ
                  </Button>
                  <span className="text-xs">
                    {page + 1} / {Math.ceil(wavs.length / PAGE_SIZE)}
                  </span>
                  <Button
                    isDisabled={(page + 1) * PAGE_SIZE >= wavs.length}
                    onPress={() => {
                      setPage(page + 1);
                    }}
                  >
                    次へ
                  </Button>
                </div>
              ) : null}
            </fieldset>
            {state.kind === "error" ? (
              <p role="alert" className="text-xs text-red-300">
                {state.message}
              </p>
            ) : null}
            {state.kind === "running" ? (
              <output className="text-xs text-slate-200">
                {state.message}
              </output>
            ) : null}
            <div className="flex gap-2">
              {running ? (
                <Button
                  onPress={() => {
                    active.current?.abort();
                    setState({ kind: "idle" });
                  }}
                >
                  推定をキャンセル
                </Button>
              ) : (
                <Button
                  tone="primary"
                  isDisabled={selected.size === 0}
                  onPress={() => {
                    void run();
                  }}
                >
                  推定して結果を確認
                </Button>
              )}
              <Button onPress={close}>閉じる</Button>
            </div>
          </>
        )}
      </div>
    </EditorDialog>
  );
};
