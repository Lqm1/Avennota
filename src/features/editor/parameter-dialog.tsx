import { useState } from "react";

import { Check } from "../../components/ui/check";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { MsField, SelectField } from "../../components/ui/field";
import {
  BatchPreview,
  tryPreview,
  usePresent,
  useScope,
} from "./batch-preview";
import { transformParameters } from "./parameter-transforms";
import type { ParameterOperation } from "./parameter-transforms";
import { closeEditorPanel } from "./settings";

type OperationKind = ParameterOperation["kind"];

const OPERATION_OPTIONS: { id: OperationKind; label: string }[] = [
  { id: "overlapThird", label: "オーバーラップを先行発声の1/3にする" },
  { id: "preutter", label: "先行発声を指定の値にする（位置は保つ）" },
  { id: "ratio", label: "先行発声とオーバーラップの位置を保ち、3:1にする" },
  { id: "bpm", label: "収録BPMに合わせる（先行発声の位置は保つ）" },
];
const HINTS: Record<OperationKind, string> = {
  overlapThird: "ほかの値は変えません。",
  preutter:
    "先行発声の位置・固定範囲の終わり・右ブランクの終端を保ったまま、左ブランクを動かします。オーバーラップは新しい先行発声の1/3にします。",
  ratio:
    "先行発声とオーバーラップの位置を変えずに左ブランクを前へ動かし、先行発声:オーバーラップを3:1にします。固定範囲と右ブランクの終端は保ちます。",
  bpm: "先行発声＝8分音符、オーバーラップ＝その1/3、固定範囲＝付点8分音符、右ブランク＝4分音符＋オーバーラップ（負の値）にします。",
};

const toOperation = (
  kind: OperationKind,
  preutter: number,
  bpm: number
): ParameterOperation => {
  if (kind === "preutter") {
    return { kind, value: preutter };
  }
  if (kind === "bpm") {
    return { kind, bpm };
  }
  return { kind };
};

export const ParameterDialog = () => {
  const present = usePresent();
  const scope = useScope(present);
  const [kind, setKind] = useState<OperationKind>("overlapThird");
  const [preutter, setPreutter] = useState(200);
  const [bpm, setBpm] = useState(120);
  const [digits, setDigits] = useState(3);
  const [continuousOnly, setContinuousOnly] = useState(true);
  const operation = toOperation(kind, preutter, bpm);
  const preview =
    present === null
      ? { result: null, error: "" }
      : tryPreview(() =>
          transformParameters(present.otoSet, scope.ids, operation, {
            digits,
            continuousOnly,
          })
        );
  return (
    <EditorDialog
      title="先行発声・オーバーラップの調整"
      onClose={closeEditorPanel}
      className="max-w-4xl"
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          {scope.field}
          <SelectField
            label="調整"
            value={kind}
            options={OPERATION_OPTIONS}
            onChange={setKind}
          />
        </div>
        <p className="text-[11px] text-slate-400">{HINTS[kind]}</p>
        <div className="grid grid-cols-3 items-end gap-2">
          {kind === "preutter" ? (
            <MsField
              label="先行発声（ms）"
              value={preutter}
              swatch={null}
              onCommit={setPreutter}
            />
          ) : null}
          {kind === "bpm" ? (
            <MsField
              label="収録BPM"
              value={bpm}
              swatch={null}
              onCommit={setBpm}
            />
          ) : null}
          <SelectField
            label="新しい値の小数桁"
            value={String(digits)}
            options={[
              { id: "0", label: "整数" },
              { id: "1", label: "小数第1位" },
              { id: "2", label: "小数第2位" },
              { id: "3", label: "小数第3位" },
            ]}
            onChange={(value) => {
              setDigits(Number(value));
            }}
          />
        </div>
        <Check
          label="連続音（「a か」のように先行母音と空白で始まる行）だけ"
          value={continuousOnly}
          onChange={setContinuousOnly}
        />
        <BatchPreview {...preview} />
      </div>
    </EditorDialog>
  );
};
