import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { SelectField, TextAreaField } from "../../components/ui/field";
import { pickDocument } from "../../platform/files/documents";
import { decodeText } from "../oto/encoding";
import {
  duplicateByRules,
  parseAliasRules,
  renameByRules,
} from "./alias-rules";
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
  { id: "exact", label: "完全一致（a お → a を）" },
  {
    id: "keepSuffix",
    label: "先頭一致・後ろの装飾を残す（a お_C4 → a を_C4）",
  },
  { id: "keepPrefix", label: "末尾一致・前の装飾を残す（強a お → 強a を）" },
  { id: "keepBoth", label: "途中の一致・前後を残す" },
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
          const rules = parseAliasRules(text);
          const options = { mode, allowDuplicates };
          return operation === "duplicate"
            ? duplicateByRules(present.otoSet, scope.ids, rules, options)
            : renameByRules(present.otoSet, scope.ids, rules, {
                ...options,
                all,
              });
        });
  return (
    <EditorDialog
      title="規則でエイリアスを複製・置換"
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
              { id: "duplicate", label: "複製して末尾へ追加" },
              { id: "rename", label: "元の行のエイリアスを置換" },
            ]}
            onChange={setOperation}
          />
          <SelectField
            label="一致のしかた"
            value={mode}
            options={MODE_OPTIONS}
            onChange={setMode}
          />
        </div>
        <TextAreaField
          label="規則（1行に「変換元,変換先」。上から順に適用）"
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
            規則ファイルを読み込む
          </Button>
          <Check
            label="既にあるエイリアスと重なっても作る"
            value={allowDuplicates}
            onChange={setAllowDuplicates}
          />
          {operation === "rename" && mode === "keepBoth" ? (
            <Check
              label="1行の中のすべての一致を置換する"
              value={all}
              onChange={setAll}
            />
          ) : null}
        </div>
        <p className="text-[11px] text-slate-400">
          複製は数値・コメント・追加欄を元の行から引き継ぎます。「き」の規則は「きゃ」のように小書きかなが続く箇所には一致しません。
        </p>
        <BatchPreview
          {...preview}
          applyLabel={operation === "duplicate" ? "複製" : "置換"}
        />
      </div>
    </EditorDialog>
  );
};
