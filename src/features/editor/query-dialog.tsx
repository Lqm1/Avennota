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
  closePanel,
  tryPreview,
  usePresent,
  useScope,
} from "./batch-preview";
import { narrowRows, rowFilterStore } from "./row-filter";
import { extractLines, findMatches, replaceMatches } from "./row-query";
import type { QueryField, QueryMode, RowQuery } from "./row-query";
import { editorStore, errorText, notify } from "./store";
import { writeSubset } from "./subset-export";

type QueryAction = "filter" | "replace" | "delete" | "export";

const FIELD_OPTIONS: { id: QueryField; label: string }[] = [
  { id: "alias", label: "エイリアス（空欄はWAV名）" },
  { id: "wav", label: "WAVファイル名" },
  { id: "comment", label: "コメント" },
  { id: "text", label: "行の原文（解釈できない行を含む）" },
];
const MODE_OPTIONS: { id: QueryMode; label: string }[] = [
  { id: "contains", label: "部分一致" },
  { id: "exact", label: "完全一致" },
  { id: "regex", label: "正規表現（JavaScript）" },
];
const ACTION_OPTIONS: { id: QueryAction; label: string }[] = [
  { id: "filter", label: "一致した行だけ表示する" },
  { id: "replace", label: "一致した部分を置換する" },
  { id: "delete", label: "一致した行を削除する" },
  { id: "export", label: "一致した行を別のiniへ書き出す" },
];

export const QueryDialog = () => {
  const present = usePresent();
  const scope = useScope(present);
  const filtered = useSelector(rowFilterStore, (state) => state !== null);
  const [query, setQuery] = useState<RowQuery>({
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
  const update = (patch: Partial<RowQuery>) => {
    setQuery({ ...query, ...patch });
  };

  let matches: string[] = [];
  let error = "";
  if (present !== null && query.text !== "") {
    try {
      matches = findMatches(present.otoSet, scope.ids, query);
    } catch (queryError) {
      error = errorText(queryError);
    }
  }
  const matched = new Set(matches);
  const preview =
    present === null || error !== "" || matches.length === 0
      ? { result: null, error }
      : tryPreview(() => {
          if (action === "replace") {
            return replaceMatches(
              present.otoSet,
              scope.ids,
              query,
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
    closePanel();
    if (deletion === null) {
      notify("info", `${written}へ${matched.size}行を書き出しました。`);
      return;
    }
    try {
      applyBatch(deletion);
    } catch {
      notify(
        "warning",
        `${written}へ書き出しました。書き出し中に編集内容が変わったため、行は削除していません。`
      );
      return;
    }
    notify(
      "info",
      `${written}へ${matched.size}行を書き出し、削除しました。Undoで削除を戻せます（書き出したファイルは残ります）。`
    );
  };

  return (
    <EditorDialog
      title="検索・置換・抽出"
      onClose={closePanel}
      className="max-w-4xl"
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {scope.field}
          <SelectField
            label="検索する欄"
            value={query.field}
            options={FIELD_OPTIONS}
            onChange={(field) => {
              update({ field });
            }}
          />
          <SelectField
            label="一致方法"
            value={query.mode}
            options={MODE_OPTIONS}
            onChange={(mode) => {
              update({ mode });
            }}
          />
        </div>
        <CommitTextField
          label="検索する文字列（Enterで確定）"
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
            label="直後に小書きかなが続く箇所を除く（「き」で「きゃ」を探さない）"
            value={query.excludeYoon}
            disabled={query.mode !== "contains"}
            onChange={(excludeYoon) => {
              update({ excludeYoon });
            }}
          />
        </div>
        <p className="text-xs text-slate-300">
          {query.text === "" ? "検索する文字列を入力してください。" : null}
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
                closePanel();
                notify("info", `${matches.length}行に絞り込みました。`);
              }}
            >
              表示を絞る
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
                label="1行の中のすべての一致を置換する"
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
              label="WAVの最後の行も削除する"
              value={allowLastRow}
              onChange={setAllowLastRow}
            />
            <BatchPreview {...preview} applyLabel="削除" />
          </>
        ) : null}
        {action === "export" ? (
          <>
            <CommitTextField
              label="書き出すiniの名前（音源フォルダに保存）"
              value={exportName}
              onCommit={setExportName}
            />
            <Check
              label="書き出した後、編集中の内容から削除する"
              value={deleteExported}
              onChange={setDeleteExported}
            />
            {deleteExported ? (
              <>
                <Check
                  label="WAVの最後の行も削除する"
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
                <Button onPress={closePanel}>キャンセル</Button>
                <Button
                  tone="primary"
                  isDisabled={matches.length === 0}
                  onPress={() => {
                    void (async () => {
                      try {
                        await exportMatches(null);
                      } catch (exportError) {
                        notify("error", errorText(exportError));
                      }
                    })();
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
