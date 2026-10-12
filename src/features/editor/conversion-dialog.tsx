import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { MsField, SelectField } from "../../components/ui/field";
import { pickDocument } from "../../platform/files/documents";
import { SyllableTable } from "../alignment/syllable-table";
import { decodeText } from "../oto/encoding";
import {
  BatchPreview,
  tryPreview,
  usePresent,
  useScope,
} from "./batch-preview";
import { closeEditorPanel } from "./settings";
import { runTool } from "./store";
import { convertVoicebank } from "./voicebank-conversion";
import type { ConversionOptions } from "./voicebank-conversion";

export const ConversionDialog = () => {
  const present = usePresent();
  const scope = useScope(present);
  const [table, setTable] = useState<{
    name: string;
    table: SyllableTable;
  } | null>(null);
  const [options, setOptions] = useState<Omit<ConversionOptions, "table">>({
    cv: true,
    cvSource: "initial",
    vc: false,
    useTableConsonant: false,
    cvPreutter: 100,
    cvOverlap: 30,
    consonantLength: 100,
    shortenPlosive: true,
    allowDuplicates: false,
  });
  const update = (patch: Partial<typeof options>) => {
    setOptions({ ...options, ...patch });
  };
  const preview =
    present === null || !(options.cv || options.vc)
      ? { result: null, error: "" }
      : tryPreview(() =>
          convertVoicebank(present.otoSet, scope.ids, {
            ...options,
            table: table?.table ?? null,
          })
        );
  return (
    <EditorDialog
      title="連続音からCV・VCを追加"
      onClose={closeEditorPanel}
      className="max-w-4xl"
    >
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-slate-400">
          「a か」「- か」などの連続音の行から、CV（か）とVC（a
          k）の行を作って末尾へ追加します。元の行は変えません。音階・強弱などの後ろの装飾は引き継ぎます。
        </p>
        <div className="grid grid-cols-2 gap-2">
          {scope.field}
          <div className="flex flex-col justify-end gap-1">
            <span className="text-[11px] text-slate-400">
              音節表（table.csv）
            </span>
            <div className="flex items-center gap-2">
              <Button
                onPress={() => {
                  void runTool(async () => {
                    const file = await pickDocument(["csv", "txt"]);
                    if (file !== null) {
                      setTable({
                        name: file.name,
                        table: SyllableTable.parse(decodeText(file.bytes)),
                      });
                    }
                  });
                }}
              >
                読み込む
              </Button>
              {table === null ? (
                <span className="text-xs text-slate-500">
                  未指定（下の共通値を使う）
                </span>
              ) : (
                <>
                  <span className="truncate text-xs text-slate-200">
                    {table.name}（{table.table.size}音節）
                  </span>
                  <Button
                    tone="ghost"
                    onPress={() => {
                      setTable(null);
                    }}
                  >
                    解除
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
        <fieldset className="border-line flex flex-col gap-2 rounded border p-3">
          <legend className="px-1 text-xs text-slate-300">CV</legend>
          <Check
            label="CVを追加する（a か・- か → か）"
            value={options.cv}
            onChange={(cv) => {
              update({ cv });
            }}
          />
          <div className="grid grid-cols-3 items-end gap-2">
            <SelectField
              label="元にする行"
              value={options.cvSource}
              isDisabled={!options.cv}
              options={[
                { id: "initial", label: "語頭の行（- か）だけ" },
                { id: "all", label: "連続音の行すべて（語頭を優先）" },
              ]}
              onChange={(cvSource) => {
                update({ cvSource });
              }}
            />
            {table === null ? (
              <>
                <MsField
                  label="CVの先行発声"
                  value={options.cvPreutter}
                  swatch={null}
                  isDisabled={!options.cv}
                  onCommit={(cvPreutter) => {
                    update({ cvPreutter });
                  }}
                />
                <MsField
                  label="CVのオーバーラップ"
                  value={options.cvOverlap}
                  swatch={null}
                  isDisabled={!options.cv}
                  onCommit={(cvOverlap) => {
                    update({ cvOverlap });
                  }}
                />
              </>
            ) : (
              <Check
                label="固定範囲に表の値を使う"
                value={options.useTableConsonant}
                disabled={!options.cv}
                onChange={(useTableConsonant) => {
                  update({ useTableConsonant });
                }}
              />
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            元の先行発声の位置と右ブランクの終端を保ちます。
            {table === null
              ? "音節表がないときは、すべての音節に同じ値を使います。"
              : "表にない音節は作りません。"}
          </p>
        </fieldset>
        <fieldset className="border-line flex flex-col gap-2 rounded border p-3">
          <legend className="px-1 text-xs text-slate-300">VC</legend>
          <Check
            label="VCを追加する（a か → a k）"
            value={options.vc}
            onChange={(vc) => {
              update({ vc });
            }}
          />
          <div className="grid grid-cols-3 items-end gap-2">
            {table === null ? (
              <MsField
                label="子音の長さ（ms）"
                value={options.consonantLength}
                swatch={null}
                isDisabled={!options.vc}
                onCommit={(consonantLength) => {
                  update({ consonantLength });
                }}
              />
            ) : null}
            <Check
              label="破裂音（k・t・p）は子音の前半で終える"
              value={options.shortenPlosive}
              disabled={!options.vc}
              onChange={(shortenPlosive) => {
                update({ shortenPlosive });
              }}
            />
          </div>
          <p className="text-[11px] text-slate-400">
            先行発声の位置を子音の長さだけ前へ移し、子音の始まりで終わる行を作ります。
            {table === null
              ? "子音名は仮名の読みから決めます。"
              : "子音名は表の2列目、子音の長さは表の先行発声を使います。"}
          </p>
        </fieldset>
        <Check
          label="既にあるエイリアスと重なっても作る"
          value={options.allowDuplicates}
          onChange={(allowDuplicates) => {
            update({ allowDuplicates });
          }}
        />
        <BatchPreview {...preview} applyLabel="追加" />
      </div>
    </EditorDialog>
  );
};
