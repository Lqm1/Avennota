import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { SelectField, TextAreaField } from "../../components/ui/field";
import { pickDocument } from "../../platform/files/documents";
import { decodeText } from "../oto/encoding";
import { AliasRules } from "./alias-rules";
import type { AliasRuleMode } from "./alias-rules";
import {
  BatchPreview,
  tryPreview,
  usePresent,
  useScope,
} from "./batch-preview";
import { closeEditorPanel } from "./settings";
import { runTool } from "./store";

const MODE_OPTIONS: { id: AliasRuleMode; label: string }[] = [
  { id: "exact", label: "完全一致（例: a お → a を）" },
  {
    id: "keepSuffix",
    label: "前方一致・接尾辞を保持（例: a お_C4 → a を_C4）",
  },
  { id: "keepPrefix", label: "後方一致・接頭辞を保持（例: 強a お → 強a を）" },
  { id: "keepBoth", label: "部分一致・前後を保持" },
];

export const AliasRulesDialog = () => {
  const present = usePresent();
  const scope = useScope(present);
  const [text, setText] = useState("");
  const [operation, setOperation] = useState<"duplicate" | "rename">(
    "duplicate"
  );
  const [mode, setMode] = useState<AliasRuleMode>("exact");
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [all, setAll] = useState(false);
  const preview =
    present === null || text.trim() === ""
      ? { result: null, error: "" }
      : tryPreview(() => {
          const rules = AliasRules.parse(text);
          const options = { mode, allowDuplicates };
          return operation === "duplicate"
            ? rules.duplicate(present.otoSet, scope.ids, options)
            : rules.rename(present.otoSet, scope.ids, { ...options, all });
        });
  return (
    <EditorDialog
      title="規則によるエイリアスの複製・置換"
      onClose={closeEditorPanel}
      className="max-w-4xl"
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {scope.field}
          <SelectField
            label="処理"
            value={operation}
            options={[
              { id: "duplicate", label: "複製して末尾に追加" },
              { id: "rename", label: "対象行のエイリアスを置換" },
            ]}
            onChange={setOperation}
          />
          <SelectField
            label="一致条件"
            value={mode}
            options={MODE_OPTIONS}
            onChange={setMode}
          />
        </div>
        <TextAreaField
          label="変換規則（1行につき「変換元,変換先」を記述。上から順に適用）"
          value={text}
          onChange={setText}
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button
            onPress={() => {
              void runTool(async () => {
                const file = await pickDocument(["ini", "csv", "txt"]);
                if (file !== null) {
                  setText(decodeText(file.bytes));
                }
              });
            }}
          >
            規則ファイルを読み込む…
          </Button>
          <Check
            label="既存のエイリアスと重複しても生成する"
            value={allowDuplicates}
            onChange={setAllowDuplicates}
          />
          {operation === "rename" && mode === "keepBoth" ? (
            <Check
              label="エイリアス内のすべての一致箇所を置換"
              value={all}
              onChange={setAll}
            />
          ) : null}
        </div>
        <p className="text-[11px] text-slate-400">
          複製時は各パラメータ・コメントを元の行から引き継ぎます。「き」等の規則は「きゃ」のように拗音（小書き文字）が続く箇所には一致しません。
        </p>
        <BatchPreview
          {...preview}
          applyLabel={operation === "duplicate" ? "複製" : "置換"}
        />
      </div>
    </EditorDialog>
  );
};
