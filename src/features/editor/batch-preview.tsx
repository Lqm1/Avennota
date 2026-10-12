import { useSelector } from "@tanstack/react-store";
import { cn } from "cn";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import { SelectField } from "../../components/ui/field";
import type { Oto, OtoSet } from "../oto/oto-set";
import { formatNumber, PARAM_KEYS, PARAM_LABELS } from "../oto/oto-set";
import { countEntries } from "./batch";
import type { BatchEntry, BatchResult, BatchScope } from "./batch";
import { cellSelectionStore, selectedCells } from "./cell-selection";
import { ParamSwatch } from "./param-swatch";
import { rowFilterStore, visibleLines } from "./row-filter";
import { showEditorPanel } from "./settings";
import type { Snapshot } from "./store";
import {
  editorStore,
  errorText,
  notify,
  transformOtoSet,
  useEditor,
} from "./store";

const PREVIEW_LIMIT = 300;

export const closePanel = () => {
  showEditorPanel(null);
};

export const usePresent = (): Snapshot | null =>
  useEditor((state) =>
    state.workspace.kind === "open" ? state.workspace.history.present : null
  );

const scopeIds = (
  otoSet: OtoSet,
  selectedId: string | null,
  scope: BatchScope
): Set<string> => {
  if (scope === "all") {
    return new Set(otoSet.lines.map((line) => line.id));
  }
  if (scope === "visible") {
    return new Set(visibleLines(otoSet).map((line) => line.id));
  }
  return new Set(
    selectedCells(otoSet, cellSelectionStore.state, selectedId).map(
      (cell) => cell.lineId
    )
  );
};

const listedCount = (otoSet: OtoSet, ids: ReadonlySet<string>) =>
  otoSet.lines.filter(
    (line) => line.parsed.kind !== "blank" && ids.has(line.id)
  ).length;

export const useScope = (present: Snapshot | null) => {
  // 「表示中の行」の件数を絞り込みの変更に追従させる。
  useSelector(rowFilterStore, (state) => state);
  const [scope, setScope] = useState<BatchScope>(() =>
    present !== null &&
    scopeIds(present.otoSet, present.selectedId, "selection").size > 1
      ? "selection"
      : "visible"
  );
  const ids = (target: BatchScope) =>
    present === null
      ? new Set<string>()
      : scopeIds(present.otoSet, present.selectedId, target);
  const count = (target: BatchScope) =>
    present === null ? 0 : listedCount(present.otoSet, ids(target));
  const field = (
    <SelectField
      label="対象"
      value={scope}
      options={[
        { id: "visible", label: `表示中の行（${count("visible")}行）` },
        { id: "selection", label: `選択範囲の行（${count("selection")}行）` },
        { id: "all", label: `すべての行（${count("all")}行）` },
      ]}
      onChange={setScope}
    />
  );
  return { field, ids: ids(scope), scope };
};

export const applyBatch = (result: BatchResult): void => {
  const { workspace } = editorStore.state;
  if (
    workspace.kind !== "open" ||
    workspace.history.present.otoSet !== result.base
  ) {
    throw new Error(
      "プレビューの作成後に編集内容が変わりました。もう一度実行してください。"
    );
  }
  transformOtoSet(() => result.otoSet);
};

const KIND_LABELS: Record<BatchEntry["kind"], string> = {
  add: "追加",
  change: "変更",
  delete: "削除",
  skip: "スキップ",
  error: "エラー",
};
const KIND_CLASSES: Record<BatchEntry["kind"], string> = {
  add: "text-emerald-300",
  change: "text-sky-300",
  delete: "text-red-300",
  skip: "text-slate-500",
  error: "text-amber-300",
};

const valueText = (oto: Oto | null, key: (typeof PARAM_KEYS)[number]) =>
  oto === null || Number.isNaN(oto[key]) ? "" : formatNumber(oto[key]);

const PreviewRow = ({ entry }: { entry: BatchEntry }) => {
  const shown = entry.after ?? entry.before;
  const renamed =
    entry.before !== null &&
    entry.after !== null &&
    entry.before.alias !== entry.after.alias;
  return (
    <tr className="border-b border-white/5">
      <td
        className={cn("px-2 py-1 whitespace-nowrap", KIND_CLASSES[entry.kind])}
      >
        {KIND_LABELS[entry.kind]}
      </td>
      <td className="max-w-32 truncate px-2 py-1 text-slate-400">
        {shown?.wav ?? ""}
      </td>
      <th className="px-2 py-1 text-left font-normal whitespace-nowrap">
        {renamed ? (
          <>
            <span className="text-slate-500">{entry.before?.alias} → </span>
            {entry.after?.alias}
          </>
        ) : (
          (shown?.alias ?? "")
        )}
      </th>
      {PARAM_KEYS.map((key) => {
        const changed =
          entry.kind !== "delete" &&
          entry.before !== null &&
          entry.after !== null &&
          valueText(entry.before, key) !== valueText(entry.after, key);
        return (
          <td
            key={key}
            className={cn(
              "px-2 py-1 text-right font-mono",
              changed && "text-sky-300"
            )}
            title={changed ? `元: ${valueText(entry.before, key)}` : undefined}
          >
            {valueText(shown, key)}
          </td>
        );
      })}
      <td
        className="max-w-56 truncate px-2 py-1 text-slate-400"
        title={entry.note}
      >
        {entry.note}
      </td>
    </tr>
  );
};

export const PreviewTable = ({
  entries,
}: {
  entries: readonly BatchEntry[];
}) => (
  <div className="border-line max-h-72 overflow-auto rounded border">
    <table className="w-full text-xs tabular-nums">
      <caption className="sr-only">処理される原音設定行</caption>
      <thead className="bg-panel sticky top-0 text-[11px] text-slate-400">
        <tr className="border-line border-b">
          <th className="px-2 py-1.5 text-left font-normal">処理</th>
          <th className="px-2 py-1.5 text-left font-normal">WAV</th>
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
          <th className="px-2 py-1.5 text-left font-normal">備考</th>
        </tr>
      </thead>
      <tbody className="text-slate-200">
        {entries.slice(0, PREVIEW_LIMIT).map((entry, index) => (
          <PreviewRow key={`${entry.lineId}-${index}`} entry={entry} />
        ))}
      </tbody>
    </table>
    {entries.length > PREVIEW_LIMIT ? (
      <p className="px-2 py-1 text-[11px] text-slate-500">
        ほか{entries.length - PREVIEW_LIMIT}件
      </p>
    ) : null}
  </div>
);

interface BatchPreviewProps {
  result: BatchResult | null;
  error: string;
  applyLabel?: string;
  onApply?: (result: BatchResult) => Promise<void>;
}

export const BatchPreview = ({
  result,
  error,
  applyLabel = "適用",
  onApply,
}: BatchPreviewProps) => {
  const [partial, setPartial] = useState(false);
  const busy = useEditor((state) => state.busy !== "");
  if (error !== "") {
    return <p className="text-xs text-red-300">{error}</p>;
  }
  if (result === null) {
    return null;
  }
  const counts = countEntries(result.entries);
  const changes = counts.add + counts.change + counts.delete;
  const summary = (["add", "change", "delete", "skip", "error"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${KIND_LABELS[kind]}${counts[kind]}件`)
    .join("・");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-300">
        {summary === "" ? "対象の行はありません。" : summary}
      </p>
      {result.entries.length > 0 ? (
        <PreviewTable entries={result.entries} />
      ) : null}
      {counts.error > 0 ? (
        <Check
          label="エラーの行を除いて適用する"
          value={partial}
          onChange={setPartial}
        />
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onPress={closePanel}>キャンセル</Button>
        <Button
          tone="primary"
          isDisabled={busy || changes === 0 || (counts.error > 0 && !partial)}
          onPress={() => {
            void (async () => {
              try {
                if (onApply === undefined) {
                  applyBatch(result);
                  closePanel();
                  notify(
                    "info",
                    `${changes}行の変更を反映しました。Undoで戻せます。`
                  );
                } else {
                  await onApply(result);
                }
              } catch (applyError) {
                notify("error", errorText(applyError));
              }
            })();
          }}
        >
          {applyLabel}
        </Button>
      </div>
    </div>
  );
};

export const tryPreview = (
  build: () => BatchResult | null
): { result: BatchResult | null; error: string } => {
  try {
    return { result: build(), error: "" };
  } catch (error) {
    return { result: null, error: errorText(error) };
  }
};
