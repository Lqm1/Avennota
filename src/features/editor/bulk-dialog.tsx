import { useState } from "react";

import { Button } from "../../components/ui/button";
import { EditorDialog } from "../../components/ui/editor-dialog";
import {
  CommitTextField,
  MsField,
  SelectField,
} from "../../components/ui/field";
import { changeAliases, changeCells } from "./bulk-edit";
import type { AliasChange, BulkChange } from "./bulk-edit";
import { cellSelectionStore, selectedCells } from "./cell-selection";
import { showEditorPanel } from "./settings";
import { editorStore, transformOtoSet } from "./store";

const close = () => {
  showEditorPanel(null);
};
export const BulkDialog = () => {
  const [change, setChange] = useState<BulkChange>({
    mode: "add",
    value: "0",
    condition: "all",
    threshold: 0,
  });
  return (
    <EditorDialog title="選択セルの値を一括変更（Ctrl/Cmd+M）" onClose={close}>
      <div className="flex flex-col gap-3">
        <SelectField
          label="変更方法"
          value={change.mode}
          options={[
            { id: "add", label: "加算" },
            { id: "subtract", label: "減算" },
            { id: "set", label: "同じ値を設定" },
            { id: "integer", label: "整数化（小数部を切り捨て）" },
          ]}
          onChange={(mode) => {
            setChange({ ...change, mode });
          }}
        />
        <CommitTextField
          label="値"
          value={change.value}
          onCommit={(value) => {
            setChange({ ...change, value });
          }}
        />
        <SelectField
          label="対象条件"
          value={change.condition}
          options={[
            { id: "all", label: "すべて" },
            { id: "equal", label: "指定値と一致" },
            { id: "atLeast", label: "指定値以上" },
            { id: "atMost", label: "指定値以下" },
          ]}
          onChange={(condition) => {
            setChange({ ...change, condition });
          }}
        />
        <MsField
          label="条件の指定値"
          value={change.threshold}
          swatch={null}
          onCommit={(threshold) => {
            setChange({ ...change, threshold });
          }}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button onPress={close}>キャンセル</Button>
          <Button
            tone="primary"
            onPress={() => {
              const { workspace } = editorStore.state;
              if (workspace.kind === "open") {
                const { otoSet, selectedId } = workspace.history.present;
                const cells = selectedCells(
                  otoSet,
                  cellSelectionStore.state,
                  selectedId
                );
                transformOtoSet((source) => changeCells(source, cells, change));
              }
              close();
            }}
          >
            実行
          </Button>
        </div>
      </div>
    </EditorDialog>
  );
};
export const AliasDialog = () => {
  const [change, setChange] = useState<AliasChange>({
    rule: "%a",
    deletePrefix: 0,
    deleteSuffix: 0,
    maxDuplicates: 0,
  });
  const [scope, setScope] = useState<"selection" | "all">("all");
  return (
    <EditorDialog title="エイリアス一括変更" onClose={close}>
      <div className="flex flex-col gap-3">
        <SelectField
          label="対象"
          value={scope}
          options={[
            { id: "all", label: "全行" },
            { id: "selection", label: "選択範囲の行" },
          ]}
          onChange={setScope}
        />
        <CommitTextField
          label="変換規則"
          value={change.rule}
          onCommit={(rule) => {
            setChange({ ...change, rule });
          }}
        />
        <p className="text-xs text-slate-400">
          %a＝現在のエイリアス、%f＝拡張子なしのファイル名、%m＝音名、%s＝接尾辞、%r＝重複番号（最初は空、2件目から2、3…）
        </p>
        <div className="grid grid-cols-3 gap-2">
          {(["deletePrefix", "deleteSuffix", "maxDuplicates"] as const).map(
            (key) => (
              <MsField
                key={key}
                label={
                  {
                    deletePrefix: "先頭削除文字数",
                    deleteSuffix: "末尾削除文字数",
                    maxDuplicates: "重複上限（0＝無制限）",
                  }[key]
                }
                value={change[key]}
                swatch={null}
                onCommit={(value) => {
                  if (value >= 0 && Number.isInteger(value)) {
                    setChange({ ...change, [key]: value });
                  }
                }}
              />
            )
          )}
        </div>
        <p className="text-xs text-amber-300">
          %rを使い重複上限を指定すると、上限を超えた行を削除します。Undoで戻せます。
        </p>
        <div className="mt-2 flex justify-end gap-2">
          <Button onPress={close}>キャンセル</Button>
          <Button
            tone="primary"
            onPress={() => {
              const { workspace } = editorStore.state;
              if (workspace.kind === "open") {
                const { otoSet, selectedId } = workspace.history.present;
                const ids = new Set(
                  scope === "all"
                    ? otoSet.lines.map((line) => line.id)
                    : selectedCells(
                        otoSet,
                        cellSelectionStore.state,
                        selectedId
                      ).map((cell) => cell.lineId)
                );
                transformOtoSet((source) => changeAliases(source, ids, change));
              }
              close();
            }}
          >
            実行
          </Button>
        </div>
      </div>
    </EditorDialog>
  );
};
