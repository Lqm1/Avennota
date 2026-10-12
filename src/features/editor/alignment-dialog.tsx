import { useEffect, useMemo, useRef, useState } from "react";
import { ProgressBar } from "react-aria-components";

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
import type { LabelRecording } from "../alignment/label-export";
import { loadJapaneseModel, phoneInventory } from "../alignment/models";
import {
  applyOtoSuggestions,
  generateSelectedOtoSuggestions,
  readCvTimingTable,
} from "../alignment/oto-generation";
import type { CvTiming, VoicebankFormat } from "../alignment/oto-generation";
import {
  readRecordingIndex,
  readRecordingTranscripts,
} from "../alignment/recordings";
import { regularizeRepeatedVowels } from "../alignment/rhythm";
import type { BoundaryCorrection } from "../alignment/rhythm";
import type { AcousticModel } from "../alignment/types";
import { decodeText } from "../oto/encoding";
import type { OtoSet, ParsedOtoLine } from "../oto/oto-set";
import {
  formatNumber,
  isOtoLine,
  PARAM_KEYS,
  PARAM_LABELS,
} from "../oto/oto-set";
import { LabelExport } from "./label-export";
import { ParamSwatch } from "./param-swatch";
import { RecordingTempoField } from "./recording-tempo";
import type { RecordingTempo } from "./recording-tempo";
import { showEditorPanel } from "./settings";
import {
  editorStore,
  errorText,
  notify,
  transformOtoSet,
  useEditor,
} from "./store";
import type { Session } from "./store";

type ApplyMode = "generate" | "update";
interface ResultState {
  kind: "result";
  before: OtoSet;
  after: OtoSet;
  session: Session;
  count: number;
  recordings: LabelRecording[];
  corrections: BoundaryCorrection[];
  onsetCorrections: { wav: string; before: number; after: number }[];
}
type RunState =
  | { kind: "idle" }
  | { kind: "running"; message: string; completed: number; total: number }
  | { kind: "error"; message: string }
  | ResultState;

const formats = [
  { id: "cv", label: "単独音（CV）" },
  { id: "vcv", label: "連続音（VCV）" },
  { id: "cvvc", label: "CVVC" },
] satisfies { id: VoicebankFormat; label: string }[];
const modes = [
  { id: "update", label: "既存行の値を補正" },
  { id: "generate", label: "設定行を新規再生成" },
] satisfies { id: ApplyMode; label: string }[];
const modeHints: Record<ApplyMode, string> = {
  update:
    "WAVファイル名とエイリアスが一致する既存行の設定値のみを更新します。コメントや行順は維持されます。",
  generate:
    "対象WAVの既存行を削除し、推定結果をもとに原音設定行を新しく生成し直します。",
};
const PAGE_SIZE = 50;
const PREVIEW_LIMIT = 100;
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
const toggled = <T,>(set: ReadonlySet<T>, value: T, on: boolean): Set<T> => {
  const next = new Set(set);
  if (on) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return next;
};

const Section = ({
  title,
  action = null,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="flex min-w-0 flex-col gap-3">
    <div className="flex min-h-7 items-center justify-between gap-2">
      <h3 className="text-xs font-semibold text-slate-400">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] leading-relaxed text-slate-400">{children}</p>
);

const FileRow = ({
  name,
  detail,
  status,
  isSet,
  onPick,
  onClear,
  pickLabel = "選択",
  clearLabel = "解除",
}: {
  name: string;
  detail: string;
  status: string;
  isSet: boolean;
  onPick: () => void;
  onClear: () => void;
  pickLabel?: string;
  clearLabel?: string;
}) => (
  <li className="flex items-center gap-3 px-3 py-2">
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs text-slate-200">{name}</p>
      <p className="truncate text-[11px] text-slate-400">
        {detail}・<span className={isSet ? "text-accent" : ""}>{status}</span>
      </p>
    </div>
    {isSet ? (
      <Button tone="ghost" onPress={onClear}>
        {clearLabel}
      </Button>
    ) : null}
    <Button onPress={onPick}>{isSet ? "変更" : pickLabel}</Button>
  </li>
);

const Progress = ({
  message,
  completed,
  total,
}: {
  message: string;
  completed: number;
  total: number;
}) => (
  <ProgressBar
    aria-label="自動推定の進捗"
    className="flex min-w-0 flex-1 flex-col gap-1.5"
    isIndeterminate={total === 0}
    maxValue={Math.max(1, total)}
    value={completed}
  >
    {({ percentage, valueText }) => (
      <>
        <span className="flex gap-2 text-xs text-slate-200">
          <span className="truncate">{message}</span>
          {total === 0 ? null : (
            <span className="ml-auto shrink-0 text-slate-400 tabular-nums">
              {completed} / {total}（{valueText}）
            </span>
          )}
        </span>
        <span className="block h-1 overflow-hidden rounded bg-white/10">
          <span
            className={
              total === 0
                ? "bg-accent block h-full w-1/3 animate-pulse"
                : "bg-accent block h-full transition-[width]"
            }
            style={total === 0 ? undefined : { width: `${percentage ?? 0}%` }}
          />
        </span>
      </>
    )}
  </ProgressBar>
);

const Footer = ({ children }: { children: React.ReactNode }) => (
  <div className="border-line bg-panel sticky -bottom-5 z-10 -mb-5 flex items-center gap-2 border-t pt-3 pb-5">
    {children}
  </div>
);

const WavList = ({
  wavs,
  selected,
  onSelect,
  transcripts,
  onTranscript,
  filenameSuffix,
}: {
  wavs: string[];
  selected: ReadonlySet<string>;
  onSelect: (selected: Set<string>) => void;
  transcripts: ReadonlyMap<string, string>;
  onTranscript: (wav: string, value: string) => void;
  filenameSuffix: string;
}) => {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(wavs.length / PAGE_SIZE));
  return (
    <Section
      title={`対象WAVファイル（${selected.size} / ${wavs.length}）`}
      action={
        <div className="flex gap-1">
          <Button
            tone="ghost"
            onPress={() => {
              onSelect(new Set(wavs));
            }}
          >
            すべて選択
          </Button>
          <Button
            tone="ghost"
            onPress={() => {
              onSelect(new Set());
            }}
          >
            選択を解除
          </Button>
        </div>
      }
    >
      <Hint>
        ファイル名から発音（仮名）を自動判定しています。実際の発音と異なる場合は直接入力して修正してください（index.csv
        が指定されている録音は、その音素列が優先されます）。
      </Hint>
      <div className="border-line overflow-hidden rounded border">
        <div className="grid grid-cols-2 gap-3 bg-black/20 px-3 py-1.5 text-[11px] text-slate-400">
          <span>WAVファイル名</span>
          <span>発音（仮名）</span>
        </div>
        <ul className="divide-y divide-white/5">
          {wavs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((wav) => (
            <li
              key={wav}
              className="grid grid-cols-2 items-center gap-3 px-3 py-1"
            >
              <div className="min-w-0 truncate">
                <Check
                  label={wav}
                  value={selected.has(wav)}
                  onChange={(on) => {
                    onSelect(toggled(selected, wav, on));
                  }}
                />
              </div>
              <CommitTextField
                label={`${wav}の発音（仮名）`}
                hideLabel
                value={
                  transcripts.get(wav) ??
                  transcriptionFromFilename(wav, filenameSuffix)
                }
                onCommit={(value) => {
                  onTranscript(wav, value);
                }}
              />
            </li>
          ))}
        </ul>
        {pages > 1 ? (
          <div className="border-line flex items-center justify-end gap-2 border-t px-3 py-1.5">
            <span className="text-[11px] text-slate-400 tabular-nums">
              {page + 1} / {pages}ページ
            </span>
            <Button
              tone="ghost"
              isDisabled={page === 0}
              onPress={() => {
                setPage(page - 1);
              }}
            >
              前へ
            </Button>
            <Button
              tone="ghost"
              isDisabled={page + 1 >= pages}
              onPress={() => {
                setPage(page + 1);
              }}
            >
              次へ
            </Button>
          </div>
        ) : null}
      </div>
    </Section>
  );
};

const Notice = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <details className="group px-3 py-2 text-xs">
    <summary className="cursor-default text-amber-200 marker:text-slate-500">
      {title}
    </summary>
    <ul className="mt-2 max-h-40 overflow-auto font-mono text-[11px] text-slate-300">
      {children}
    </ul>
  </details>
);

const ChangedLines = ({ lines }: { lines: ParsedOtoLine[] }) => (
  <Section
    title={`変更される設定行（${lines.length}行）`}
    action={
      lines.length > PREVIEW_LIMIT ? (
        <span className="text-[11px] text-slate-400">
          先頭 {PREVIEW_LIMIT} 行を表示中
        </span>
      ) : null
    }
  >
    <div className="border-line max-h-80 overflow-auto rounded border">
      <table className="w-full text-xs tabular-nums">
        <caption className="sr-only">変更される設定行</caption>
        <thead className="bg-panel sticky top-0 text-[11px] text-slate-400">
          <tr className="border-line border-b">
            <th className="px-2 py-1.5 text-left font-normal">WAVファイル</th>
            <th className="px-2 py-1.5 text-left font-normal">エイリアス</th>
            {PARAM_KEYS.map((key) => (
              <th
                key={key}
                className="px-2 py-1.5 text-right font-normal whitespace-nowrap"
              >
                <span className="inline-flex items-center gap-1">
                  <ParamSwatch param={key} />
                  {PARAM_LABELS[key]}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-slate-200">
          {lines.slice(0, PREVIEW_LIMIT).map((line) => (
            <tr key={line.id} className="border-b border-white/5">
              <td className="max-w-40 truncate px-2 py-1 text-slate-400">
                {line.parsed.oto.wav}
              </td>
              <th className="px-2 py-1 text-left font-normal whitespace-nowrap">
                {line.parsed.oto.alias}
              </th>
              {PARAM_KEYS.map((key) => (
                <td key={key} className="px-2 py-1 text-right font-mono">
                  {formatNumber(line.parsed.oto[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Section>
);

const ResultView = ({
  result,
  mode,
  onBack,
  onApply,
  onClose,
}: {
  result: ResultState;
  mode: ApplyMode;
  onBack: () => void;
  onApply: () => void;
  onClose: () => void;
}) => {
  const preview = useMemo(() => {
    const before = new Map(result.before.lines.map((line) => [line.id, line]));
    const after = new Set(result.after.lines.map((line) => line.id));
    return {
      changed: result.after.lines
        .filter(isOtoLine)
        .filter((line) => before.get(line.id) !== line),
      removed: result.before.lines
        .filter(isOtoLine)
        .filter((line) => !after.has(line.id)),
    };
  }, [result]);
  const unchanged = result.after === result.before;
  const notices =
    preview.removed.length +
    result.onsetCorrections.length +
    result.corrections.length;
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-3 gap-2">
        {[
          { label: "推定対象WAV", value: result.count },
          { label: "変更される行", value: preview.changed.length },
          { label: "削除される行", value: preview.removed.length },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="border-line rounded border bg-black/15 px-3 py-2"
          >
            <dt className="text-[11px] text-slate-400">{label}</dt>
            <dd className="text-lg text-slate-100 tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {unchanged ? (
        <p className="border-line rounded border px-3 py-2 text-xs text-slate-300">
          {mode === "generate"
            ? "現在の原音設定と推定結果が同一のため、変更はありません。"
            : "補正対象となる行がありません（現在の設定値と同一か、WAVファイル名とエイリアスが一致する行が存在しません）。"}
        </p>
      ) : null}
      {notices > 0 ? (
        <Section title="確認事項">
          <div className="border-line divide-y divide-white/5 rounded border">
            {preview.removed.length > 0 ? (
              <Notice
                title={`再生成に伴い削除される設定行（${preview.removed.length}行）`}
              >
                {preview.removed.slice(0, PREVIEW_LIMIT).map((line) => (
                  <li key={line.id}>
                    {line.parsed.oto.wav}: {line.parsed.oto.alias}
                  </li>
                ))}
                {preview.removed.length > PREVIEW_LIMIT ? (
                  <li>…他 {preview.removed.length - PREVIEW_LIMIT} 行</li>
                ) : null}
              </Notice>
            ) : null}
            {result.onsetCorrections.length > 0 ? (
              <Notice
                title={`単独音（CV）の基準位置を有声開始に合わせて補正（${result.onsetCorrections.length}件）`}
              >
                {result.onsetCorrections.map((correction) => (
                  <li key={correction.wav}>
                    {correction.wav}: {formatNumber(correction.before * 1000)} →{" "}
                    {formatNumber(correction.after * 1000)} ms
                  </li>
                ))}
              </Notice>
            ) : null}
            {result.corrections.length > 0 ? (
              <Notice
                title={`同一母音連続の境界を収録BPMで補正（${result.corrections.length}件）`}
              >
                {result.corrections.map((correction) => (
                  <li key={`${correction.wav}:${correction.before}`}>
                    {correction.wav}（{correction.phone}）:{" "}
                    {formatNumber(correction.before * 1000)} →{" "}
                    {formatNumber(correction.after * 1000)} ms
                  </li>
                ))}
              </Notice>
            ) : null}
          </div>
        </Section>
      ) : null}
      {preview.changed.length > 0 ? (
        <ChangedLines lines={preview.changed} />
      ) : null}
      <LabelExport
        recordings={result.recordings}
        folder={result.session.folder}
      />
      <Footer>
        <Button onPress={onBack}>設定に戻る</Button>
        <span className="ml-auto text-[11px] text-slate-400">
          反映後も「元に戻す」（Ctrl/Cmd+Z）で一括して取り消せます
        </span>
        <Button onPress={onClose}>破棄して閉じる</Button>
        <Button tone="primary" isDisabled={unchanged} onPress={onApply}>
          原音設定に反映する
        </Button>
      </Footer>
    </div>
  );
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(wavs)
  );
  const [transcripts, setTranscripts] = useState(new Map<string, string>());
  const [index, setIndex] = useState(new Map<string, string[]>());
  const [outputFormats, setOutputFormats] = useState<
    ReadonlySet<VoicebankFormat>
  >(() => new Set<VoicebankFormat>(["vcv"]));
  const [mode, setMode] = useState<ApplyMode>(
    workspace.kind === "open" && workspace.session.baseline !== null
      ? "update"
      : "generate"
  );
  const [tempo, setTempo] = useState<RecordingTempo>({
    kind: "default",
    bpm: 120,
  });
  const { bpm } = tempo;
  const selectedWavs = useMemo(
    () => wavs.filter((wav) => selected.has(wav)),
    [wavs, selected]
  );
  const [adapt, setAdapt] = useState(true);
  const [suffix, setSuffix] = useState("");
  const [filenameSuffix, setFilenameSuffix] = useState("");
  const [limit, setLimit] = useState(1);
  const [cvTimings, setCvTimings] = useState(new Map<string, CvTiming>());
  const [customModel, setCustomModel] = useState<AcousticModel | null>(null);
  const [state, setState] = useState<RunState>({ kind: "idle" });
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
        const mapText = decodeText(phonemap.bytes);
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
          setIndex(readRecordingIndex(decodeText(file.bytes)));
        } else {
          setCvTimings(readCvTimingTable(decodeText(file.bytes)));
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
      selected.size === 0 ||
      outputFormats.size === 0 ||
      tempo.kind === "estimating"
    ) {
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    const report = (message: string, completed = 0, total = 0) => {
      if (!controller.signal.aborted) {
        setState({ kind: "running", message, completed, total });
      }
    };
    report("発音テキストを確認中…");
    await runInferenceTask(
      async () => {
        const recordings = await readRecordingTranscripts({
          folder: current.session.folder,
          wavs: selectedWavs,
          index,
          transcripts,
          filenameSuffix,
        });
        controller.signal.throwIfAborted();
        report("音響モデルを読み込み中…");
        const model =
          customModel ?? (await loadJapaneseModel(controller.signal));
        const aligned = await inferRecordings({
          folder: current.session.folder,
          model,
          recordings,
          format: outputFormats.has("cv") ? "cv" : "vcv",
          signal: controller.signal,
          adapt,
          onTrainingProgress: (completed, total) => {
            report("音源に合わせてモデルを追加学習中…", completed, total);
          },
          onProgress: (completed, total, wav) => {
            report(`音素境界を推定中: ${wav}`, completed, total);
          },
        });
        const adjusted = aligned.map((recording) =>
          outputFormats.size === 1 && outputFormats.has("cv")
            ? { recording, corrections: [] }
            : regularizeRepeatedVowels(recording, bpm)
        );
        const suggestions = adjusted.flatMap(({ recording }) =>
          generateSelectedOtoSuggestions(recording, {
            formats: outputFormats,
            bpm,
            suffix,
            cvTimings,
          })
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
          recordings: aligned,
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
        message:
          "推定処理の実行中にエディターの編集内容が変更されました。お手数ですが、再度推定を実行してください。",
      });
      return;
    }
    transformOtoSet(() => state.after);
    notify(
      "info",
      `${state.count}件のWAVファイルの推定結果を反映しました。波形画面で設定値を確認の上、保存してください（元に戻す操作で一括取り消しが可能です）。`
    );
    close();
  };
  const ready =
    selected.size > 0 && outputFormats.size > 0 && tempo.kind !== "estimating";
  let idleMessage = `${selected.size}件のWAVファイルを推定します`;
  if (selected.size === 0 || outputFormats.size === 0) {
    idleMessage = "対象のWAVファイルと生成するエイリアス形式を選択してください";
  } else if (tempo.kind === "estimating") {
    idleMessage = "収録BPMを推定中です。完了までお待ちください";
  }
  return (
    <EditorDialog
      title="原音設定の自動推定"
      onClose={close}
      className="max-w-5xl"
    >
      {state.kind === "result" ? (
        <ResultView
          result={state}
          mode={mode}
          onBack={() => {
            setState({ kind: "idle" });
          }}
          onApply={apply}
          onClose={close}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-xs text-slate-400">
            音声から音素境界を自動推定し、原音設定を生成・補正します。推定結果を確認してから反映でき、保存を実行するまで
            oto.ini は上書きされません。
          </p>
          <fieldset
            disabled={running}
            className="grid min-w-0 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]"
          >
            <legend className="sr-only">自動推定の設定</legend>
            <div className="flex min-w-0 flex-col gap-6">
              <Section title="生成するエイリアス">
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {formats.map(({ id, label }) => (
                    <Check
                      key={id}
                      label={label}
                      value={outputFormats.has(id)}
                      onChange={(on) => {
                        setOutputFormats((previous) =>
                          toggled(previous, id, on)
                        );
                      }}
                    />
                  ))}
                </div>
                <Hint>
                  複数の形式を同時に選択できます。形式間で共通するエイリアスは自動的に統合されます。
                </Hint>
                <div className="grid grid-cols-2 gap-3">
                  <SelectField
                    label="反映方法"
                    value={mode}
                    options={modes}
                    onChange={setMode}
                  />
                  <CommitTextField
                    label="エイリアス接尾辞"
                    value={suffix}
                    onCommit={setSuffix}
                  />
                  {mode === "generate" ? (
                    <MsField
                      label="重複エイリアスの生成上限（0: 無制限）"
                      value={limit}
                      onCommit={(value) => {
                        setLimit(Math.max(0, Math.trunc(value)));
                      }}
                      swatch={null}
                    />
                  ) : null}
                </div>
                <Hint>{modeHints[mode]}</Hint>
              </Section>
              <Section title="収録設定">
                <div className="grid grid-cols-2 items-start gap-3">
                  {workspace.kind === "open" ? (
                    <RecordingTempoField
                      folder={workspace.session.folder}
                      wavs={selectedWavs}
                      index={index}
                      transcripts={transcripts}
                      filenameSuffix={filenameSuffix}
                      model={customModel}
                      value={tempo}
                      onChange={setTempo}
                      isDisabled={running}
                    />
                  ) : null}
                  <CommitTextField
                    label="ファイル名から除く接尾辞（音階等）"
                    value={filenameSuffix}
                    onCommit={setFilenameSuffix}
                  />
                </div>
                <Hint>
                  連続音・CVVCの各パラメータの算出や、同一母音が連続する箇所の境界補正に使用します。
                </Hint>
              </Section>
              <Section title="音響モデル・参照ファイル">
                <ul className="border-line divide-y divide-white/5 rounded border">
                  <FileRow
                    name={
                      customModel?.name ?? "Intunist 日本語歌唱モデル（汎用）"
                    }
                    detail="音響モデル"
                    status={
                      customModel === null
                        ? "標準モデル（自動取得）"
                        : "カスタムモデル適用中"
                    }
                    isSet={customModel !== null}
                    pickLabel="モデルを選択"
                    clearLabel="標準モデルに戻す"
                    onPick={() => {
                      void readFile("model");
                    }}
                    onClear={() => {
                      setCustomModel(null);
                    }}
                  />
                  <FileRow
                    name="index.csv"
                    detail="発音・音素列対応表"
                    status={
                      index.size === 0
                        ? "未指定（音源フォルダ内を自動使用）"
                        : `${index.size}件の録音を指定中`
                    }
                    isSet={index.size > 0}
                    pickLabel="ファイルを選択"
                    onPick={() => {
                      void readFile("index");
                    }}
                    onClear={() => {
                      setIndex(new Map());
                    }}
                  />
                  <FileRow
                    name="table.csv"
                    detail="単独音タイミング設定表"
                    status={
                      cvTimings.size === 0
                        ? "未指定（音素境界から自動算出）"
                        : `${cvTimings.size}音の設定を指定中`
                    }
                    isSet={cvTimings.size > 0}
                    pickLabel="ファイルを選択"
                    onPick={() => {
                      void readFile("timings");
                    }}
                    onClear={() => {
                      setCvTimings(new Map());
                    }}
                  />
                </ul>
                <Check
                  label="音源の音声に合わせてモデルを追加学習（適応）する"
                  value={adapt}
                  onChange={setAdapt}
                />
                <Hint>
                  追加学習を行う場合は、多様な発音を含む録音を選択してください。録音数が少ない場合や低音の音源では、かえって精度が低下することがあります。
                </Hint>
              </Section>
            </div>
            <WavList
              wavs={wavs}
              selected={selected}
              onSelect={setSelected}
              transcripts={transcripts}
              onTranscript={(wav, value) => {
                setTranscripts((previous) => new Map(previous).set(wav, value));
              }}
              filenameSuffix={filenameSuffix}
            />
          </fieldset>
          <Footer>
            {state.kind === "running" ? (
              <Progress
                message={state.message}
                completed={state.completed}
                total={state.total}
              />
            ) : null}
            {state.kind === "error" ? (
              <p role="alert" className="min-w-0 flex-1 text-xs text-red-300">
                {state.message}
              </p>
            ) : null}
            {state.kind === "idle" ? (
              <span className="flex-1 text-[11px] text-slate-400">
                {idleMessage}
              </span>
            ) : null}
            <Button onPress={close}>閉じる</Button>
            {running ? (
              <Button
                tone="danger"
                onPress={() => {
                  active.current?.abort();
                  setState({ kind: "idle" });
                }}
              >
                処理を中止
              </Button>
            ) : (
              <Button
                tone="primary"
                isDisabled={!ready}
                onPress={() => {
                  void run();
                }}
              >
                自動推定を実行
              </Button>
            )}
          </Footer>
        </div>
      )}
    </EditorDialog>
  );
};
