import { CopyPlus, Plus, Trash } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../../components/ui/button";
import {
  CommitTextField,
  MsField,
  SelectField,
} from "../../components/ui/field";
import type { VoiceFolder } from "../../platform/files";
import { useDuration } from "../audio/wav-cache";
import { MARKER_KEYS, toggleCutoffSign } from "../oto/geometry";
import {
  fileStem,
  PARAM_KEYS,
  PARAM_LABELS,
  replaceLine,
} from "../oto/oto-set";
import { editCell } from "./bulk-edit";
import { statusToneClass } from "./oto-table";
import { ParamSwatch } from "./param-swatch";
import type { OtoRow, ParsedOtoRow } from "./rows";
import { settingsStore } from "./settings";
import {
  addLine,
  deleteLine,
  duplicateLine,
  updateAlias,
  updateLineText,
  updateParams,
  useMarkerParams,
  transformOtoSet,
} from "./store";

const OtoFields = ({
  row,
  folder,
}: {
  row: ParsedOtoRow;
  folder: VoiceFolder;
}) => {
  const { line } = row;
  const { oto } = line.parsed;
  const duration = useDuration(folder, oto.wav);
  const params = useMarkerParams(line.id, oto);
  const cutoffNote =
    oto.cutoff < 0 ? "負（左ブランクからの長さ）" : "正（末尾からの距離）";
  return (
    <>
      <CommitTextField
        label="エイリアス"
        value={oto.alias}
        onCommit={(alias) => {
          updateAlias(line.id, alias);
        }}
      />
      {oto.alias === "" ? (
        <p className="-mt-2 text-[11px] text-slate-500">
          空欄のときはファイル名「{fileStem(oto.wav)}」で呼ばれます。
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
        {PARAM_KEYS.map((key) => (
          <MsField
            key={key}
            hint={MARKER_KEYS[key]}
            label={PARAM_LABELS[key]}
            swatch={<ParamSwatch param={key} />}
            value={params[key]}
            onCommit={(value) => {
              transformOtoSet((source) =>
                editCell(
                  source,
                  { lineId: line.id, column: key },
                  String(value),
                  settingsStore.state.offsetMode === "positions"
                )
              );
            }}
          />
        ))}
        {/* 隣の数値欄と高さをそろえるため、説明は1行に収めて省略分はtitleで示す。 */}
        <div className="flex min-w-0 flex-col justify-end gap-1">
          <span
            className="truncate text-[11px] text-slate-500"
            title={`右ブランクは${cutoffNote}`}
          >
            右ブランクは{cutoffNote}
          </span>
          <Button
            isDisabled={duration === undefined}
            onPress={() => {
              if (duration !== undefined) {
                updateParams(line.id, toggleCutoffSign(oto, duration));
              }
            }}
          >
            {oto.cutoff < 0 ? "正の表現に変える" : "負の表現に変える"}
          </Button>
        </div>
      </div>
      <CommitTextField
        label="コメント"
        value={line.comment ?? ""}
        onCommit={(comment) => {
          transformOtoSet((set) =>
            replaceLine(set, line.id, (current) => ({
              ...current,
              comment: comment.replaceAll(/\r?\n/gu, " "),
            }))
          );
        }}
      />
    </>
  );
};

export const Inspector = ({
  row,
  folder,
}: {
  row: OtoRow;
  folder: VoiceFolder;
}) => (
  <>
    {row.kind === "oto" ? (
      <OtoFields row={row} folder={folder} />
    ) : (
      <CommitTextField
        label="解釈できない行（そのまま保存します）"
        errorText={row.line.parsed.reason}
        value={row.line.text}
        onCommit={(text) => {
          updateLineText(row.id, text);
        }}
      />
    )}
    <ul className="flex flex-col gap-1 text-[11px]">
      {row.statuses.map((status) => (
        <li className={statusToneClass[status.tone]} key={status.text}>
          {status.text}
        </li>
      ))}
    </ul>
    <div className="flex flex-wrap gap-2">
      <Button
        aria-label="行を複製（Ctrl+I）"
        onPress={() => {
          duplicateLine(row.id);
        }}
      >
        <CopyPlus className="size-3.5" />
        行を複製
        <kbd className="hidden font-mono text-[10px] opacity-60 @sm:inline">
          Ctrl+I
        </kbd>
      </Button>
      <Button
        aria-label="行を削除（Ctrl+D）"
        tone="danger"
        onPress={() => {
          deleteLine(row.id);
        }}
      >
        <Trash className="size-3.5" />
        行を削除
        <kbd className="hidden font-mono text-[10px] opacity-70 @sm:inline">
          Ctrl+D
        </kbd>
      </Button>
    </div>
  </>
);

/** 未選択はこの入力欄の中でだけ扱う。 */
export const AddLine = ({ wavNames }: { wavNames: string[] }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const options = useMemo(
    () => wavNames.map((name) => ({ id: name, label: name })),
    [wavNames]
  );
  const wav = options.find((option) => option.id === selected);
  return (
    <div className="border-line flex shrink-0 items-center gap-2 border-t px-3 py-2">
      <SelectField
        className="min-w-0 flex-1"
        hideLabel
        isDisabled={options.length === 0}
        label="WAVを選んで行を追加"
        onChange={setSelected}
        options={options}
        placeholder="WAVを選んで行を追加"
        value={selected}
      />
      <Button
        isDisabled={wav === undefined}
        onPress={() => {
          if (wav !== undefined) {
            addLine(wav.id);
          }
        }}
      >
        <Plus className="size-3.5" />
        追加
      </Button>
    </div>
  );
};
