import { useSelector } from "@tanstack/react-store";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { CommitTextField, SelectField } from "../../components/ui/field";
import { deleteLines } from "./batch";
import type { BatchResult } from "./batch";
import {
  applyBatch,
  BatchPreview,
  tryPreview,
  usePresent,
  useScope,
} from "./batch-preview";
import { narrowRows, rowFilterStore } from "./row-filter";
import { extractLines, RowQuery } from "./row-query";
import type { QueryField, QueryMode, RowQueryOptions } from "./row-query";
import { closeEditorPanel } from "./settings";
import { editorStore, errorText, notify, runTool } from "./store";
import { writeSubset } from "./subset-export";

type QueryAction = "filter" | "replace" | "delete" | "export";

const FIELD_OPTIONS: { id: QueryField; label: string }[] = [
  { id: "alias", label: "エイリアス（空欄時はWAV名）" },
  { id: "wav", label: "WAVファイル名" },
  { id: "comment", label: "コメント" },
  { id: "text", label: "行の原文（未解釈行を含む）" },
];
const MODE_OPTIONS: { id: QueryMode; label: string }[] = [
  { id: "contains", label: "部分一致" },
  { id: "exact", label: "完全一致" },
  { id: "regex", label: "正規表現（JavaScript）" },
];
const ACTION_OPTIONS: { id: QueryAction; label: string }[] = [
  { id: "filter", label: "一致した行のみ絞り込み表示" },
  { id: "replace", label: "一致箇所を置換" },
  { id: "delete", label: "一致した行を削除" },
  { id: "export", label: "一致した行を別ファイルへ抽出（書き出し）" },
];

export const QueryDialog = () => {
  const present = usePresent();
  const scope = useScope(present);
  const filtered = useSelector(rowFilterStore, (state) => state !== null);
  const [query, setQuery] = useState<RowQueryOptions>({
    field: "alias",
    mode: "contains",
    text: "",
    ignoreCase: false,
    excludeYoon: false,
  });
  const [action, setAction] = useState<QueryAction>("filter");
  const [replacement, setReplacement] = useState("");
  const [replaceAll, setReplaceAll] = useState(true);
  const [allowLastRow, setAllowLastRow] = useState(false);
  const [exportName, setExportName] = useState("oto-extract.ini");
  const [deleteExported, setDeleteExported] = useState(false);
  const update = (patch: Partial<RowQueryOptions>) => {
    setQuery({ ...query, ...patch });
  };

  let rowQuery: RowQuery | null = null;
  let matches: string[] = [];
  let error = "";
  if (present !== null && query.text !== "") {
    try {
      rowQuery = new RowQuery(query);
      matches = rowQuery.matchingIds(present.otoSet, scope.ids);
    } catch (queryError) {
      error = errorText(queryError);
    }
  }
  const matched = new Set(matches);
  const preview =
    present === null || rowQuery === null || matches.length === 0
      ? { result: null, error }
      : tryPreview(() => {
          if (action === "replace") {
            return rowQuery.replace(
              present.otoSet,
              scope.ids,
              replacement,
              replaceAll
            );
          }
          if (action === "delete" || (action === "export" && deleteExported)) {
            return deleteLines(present.otoSet, matched, allowLastRow);
          }
          return null;
        });

  const exportMatches = async (deletion: BatchResult | null) => {
    const { workspace } = editorStore.state;
    if (workspace.kind === "closed" || present === null) {
      return;
    }
    const written = await writeSubset(
      workspace.session,
      exportName,
      extractLines(present.otoSet, matched)
    );
    if (written === null) {
      return;
    }
    closeEditorPanel();
    if (deletion === null) {
      notify("info", `${written} へ ${matched.size}行を書き出しました。`);
      return;
    }
    try {
      applyBatch(deletion);
    } catch {
      notify(
        "warning",
        `${written} へ書き出しました。書き出し中に編集内容が変更されたため、行の削除は行われませんでした。`
      );
      return;
    }
    notify(
      "info",
      `${written} へ ${matched.size}行を書き出して削除しました。「元に戻す」で削除を取り消せます（書き出しファイルは保持されます）。`
    );
  };

  return (
    <EditorDialog
      title="検索・置換・抽出"
      onClose={closeEditorPanel}
      className="max-w-4xl"
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {scope.field}
          <SelectField
            label="検索対象"
            value={query.field}
            options={FIELD_OPTIONS}
            onChange={(field) => {
              update({ field });
            }}
          />
          <SelectField
            label="一致条件"
            value={query.mode}
            options={MODE_OPTIONS}
            onChange={(mode) => {
              update({ mode });
            }}
          />
        </div>
        <CommitTextField
          label="検索文字列（Enterで確定）"
          value={query.text}
          errorText={error}
          onCommit={(text) => {
            update({ text });
          }}
        />
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Check
            label="大文字と小文字を区別しない"
            value={query.ignoreCase}
            onChange={(ignoreCase) => {
              update({ ignoreCase });
            }}
          />
          <Check
            label="直後に拗音（小書き文字）が続く箇所を除外（例:「き」で「きゃ」を除外）"
            value={query.excludeYoon}
            disabled={query.mode !== "contains"}
            onChange={(excludeYoon) => {
              update({ excludeYoon });
            }}
          />
        </div>
        <p className="text-xs text-slate-300">
          {query.text === "" ? "検索文字列を入力してください。" : null}
          {query.text !== "" && error === ""
            ? `${matches.length}行が一致`
            : null}
        </p>
        <SelectField
          label="一致した行の処理"
          value={action}
          options={ACTION_OPTIONS}
          onChange={setAction}
        />
        {action === "filter" ? (
          <div className="flex justify-end gap-2">
            {filtered ? (
              <Button
                onPress={() => {
                  rowFilterStore.setState(() => null);
                }}
              >
                絞り込みを解除
              </Button>
            ) : null}
            <Button
              tone="primary"
              isDisabled={matches.length === 0}
              onPress={() => {
                narrowRows(matches);
                closeEditorPanel();
                notify("info", `${matches.length}行に絞り込みました。`);
              }}
            >
              絞り込み実行
            </Button>
          </div>
        ) : null}
        {action === "replace" ? (
          <>
            <CommitTextField
              label={
                query.mode === "regex"
                  ? "置換後の文字列（$1などで一致部分を参照）"
                  : "置換後の文字列"
              }
              value={replacement}
              onCommit={setReplacement}
            />
            {query.mode === "regex" ? (
              <Check
                label="行内のすべての一致箇所を置換"
                value={replaceAll}
                onChange={setReplaceAll}
              />
            ) : null}
            <BatchPreview {...preview} applyLabel="置換" />
          </>
        ) : null}
        {action === "delete" ? (
          <>
            <Check
              label="WAVの最後の1行も削除を許可"
              value={allowLastRow}
              onChange={setAllowLastRow}
            />
            <BatchPreview {...preview} applyLabel="削除" />
          </>
        ) : null}
        {action === "export" ? (
          <>
            <CommitTextField
              label="書き出しファイル名（音源フォルダ内に保存）"
              value={exportName}
              onCommit={setExportName}
            />
            <Check
              label="書き出し後、元の原音設定から削除する"
              value={deleteExported}
              onChange={setDeleteExported}
            />
            {deleteExported ? (
              <>
                <Check
                  label="WAVの最後の1行も削除を許可"
                  value={allowLastRow}
                  onChange={setAllowLastRow}
                />
                <BatchPreview
                  {...preview}
                  applyLabel="書き出して削除"
                  onApply={exportMatches}
                />
              </>
            ) : (
              <div className="flex justify-end gap-2">
                <Button onPress={closeEditorPanel}>キャンセル</Button>
                <Button
                  tone="primary"
                  isDisabled={matches.length === 0}
                  onPress={() => {
                    void runTool(async () => {
                      await exportMatches(null);
                    });
                  }}
                >
                  書き出す
                </Button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </EditorDialog>
  );
};
