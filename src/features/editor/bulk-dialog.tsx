import { useState } from "react";

import { Button } from "../../components/ui/button";
import { EditorDialog } from "../../components/ui/editor-dialog";
import {
  CommitTextField,
  MsField,
  SelectField,
} from "../../components/ui/field";
import { usePresent, useScope } from "./batch-preview";
import { changeAliases, changeCells } from "./bulk-edit";
import type { AliasChange, BulkChange } from "./bulk-edit";
import { cellSelectionStore, selectedCells } from "./cell-selection";
import { closeEditorPanel } from "./settings";
import { editorStore, transformOtoSet } from "./store";

export const BulkDialog = () => {
  const [change, setChange] = useState<BulkChange>({
    mode: "add",
    value: "0",
    condition: "all",
    threshold: 0,
  });
  return (
    <EditorDialog title="選択セルの値を一括変更" onClose={closeEditorPanel}>
      <div className="flex flex-col gap-3">
        <SelectField
          label="変更方法"
          value={change.mode}
          options={[
            { id: "add", label: "加算" },
            { id: "subtract", label: "減算" },
            { id: "set", label: "指定値に設定" },
            { id: "integer", label: "整数化（小数点以下切り捨て）" },
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
          <Button onPress={closeEditorPanel}>キャンセル</Button>
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
              closeEditorPanel();
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
  const scope = useScope(usePresent());
  return (
    <EditorDialog title="エイリアスの一括変更" onClose={closeEditorPanel}>
      <div className="flex flex-col gap-3">
        {scope.field}
        <CommitTextField
          label="変換規則"
          value={change.rule}
          onCommit={(rule) => {
            setChange({ ...change, rule });
          }}
        />
        <p className="text-xs text-slate-400">
          %a: 現在のエイリアス / %f: ファイル名（拡張子なし） / %m: 音階 / %s:
          接尾辞 / %r: 重複連番（2件目以降 2, 3…）
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
                    maxDuplicates: "重複上限数（0で無制限）",
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
          %r
          を使用して重複上限数を指定した場合、上限を超えた行は削除されます（元に戻す操作で復元可能です）。
        </p>
        <div className="mt-2 flex justify-end gap-2">
          <Button onPress={closeEditorPanel}>キャンセル</Button>
          <Button
            tone="primary"
            onPress={() => {
              transformOtoSet((source) =>
                changeAliases(source, scope.ids, change)
              );
              closeEditorPanel();
            }}
          >
            実行
          </Button>
        </div>
      </div>
    </EditorDialog>
  );
};
