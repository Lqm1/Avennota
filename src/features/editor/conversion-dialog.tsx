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
          「a か」「- か」等の連続音行から、単独音CV（「か」）やVC（「a
          k」）の行を生成して末尾に追加します。元の設定行は変更されず、音階等の接尾辞は引き継がれます。
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
                読み込む…
              </Button>
              {table === null ? (
                <span className="text-xs text-slate-500">
                  未指定（下記の設定値を使用）
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
            label="CVを追加（a か・- か → か）"
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
                { id: "initial", label: "語頭の行（- か）のみ" },
                { id: "all", label: "すべての連続音行（語頭を優先）" },
              ]}
              onChange={(cvSource) => {
                update({ cvSource });
              }}
            />
            {table === null ? (
              <>
                <MsField
                  label="CVの先行発声（ms）"
                  value={options.cvPreutter}
                  swatch={null}
                  isDisabled={!options.cv}
                  onCommit={(cvPreutter) => {
                    update({ cvPreutter });
                  }}
                />
                <MsField
                  label="CVのオーバーラップ（ms）"
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
                label="固定範囲に音節表の値を使用"
                value={options.useTableConsonant}
                disabled={!options.cv}
                onChange={(useTableConsonant) => {
                  update({ useTableConsonant });
                }}
              />
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            元の先行発声および右ブランクの絶対位置を維持します。
            {table === null
              ? "音節表が未指定の場合は、全音節で共通値を使用します。"
              : "音節表に存在しない音節は生成されません。"}
          </p>
        </fieldset>
        <fieldset className="border-line flex flex-col gap-2 rounded border p-3">
          <legend className="px-1 text-xs text-slate-300">VC</legend>
          <Check
            label="VCを追加（a か → a k）"
            value={options.vc}
            onChange={(vc) => {
              update({ vc });
            }}
          />
          <div className="grid grid-cols-3 items-end gap-2">
            {table === null ? (
              <MsField
                label="子音長（ms）"
                value={options.consonantLength}
                swatch={null}
                isDisabled={!options.vc}
                onCommit={(consonantLength) => {
                  update({ consonantLength });
                }}
              />
            ) : null}
            <Check
              label="破裂音（k・t・pなど）の右ブランクを短縮"
              value={options.shortenPlosive}
              disabled={!options.vc}
              onChange={(shortenPlosive) => {
                update({ shortenPlosive });
              }}
            />
          </div>
          <p className="text-[11px] text-slate-400">
            先行発声の絶対位置を子音長分前にシフトし、子音部を切り出すVC行を生成します。
            {table === null
              ? "子音名は仮名の読みから自動判定されます。"
              : "子音名および子音長には音節表の値を使用します。"}
          </p>
        </fieldset>
        <Check
          label="既存のエイリアスと重複しても生成する"
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
