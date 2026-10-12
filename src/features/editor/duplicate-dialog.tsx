import { useSelector } from "@tanstack/react-store";
import { Eye, Play } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Check } from "../../components/ui/check";
import { EditorDialog } from "../../components/ui/editor-dialog";
import { CommitTextField, SelectField } from "../../components/ui/field";
import { playFileRange } from "../audio/file-player";
import {
  durationStore,
  EMPTY_DURATIONS,
  loadWavBlob,
} from "../audio/wav-cache";
import { paramWarnings, rangeWarnings } from "../oto/geometry";
import type { ParsedOtoLine } from "../oto/oto-set";
import {
  formatNumber,
  isOtoLine,
  PARAM_KEYS,
  PARAM_LABELS,
} from "../oto/oto-set";
import { BatchPreview, tryPreview, usePresent } from "./batch-preview";
import { findDuplicateGroups, removeDuplicates } from "./duplicate-aliases";
import type { DuplicateGroup } from "./duplicate-aliases";
import { rowFilterStore } from "./row-filter";
import { closeEditorPanel } from "./settings";
import { editorStore, errorText, notify, select } from "./store";

const GROUP_LIMIT = 100;

const audition = async (line: ParsedOtoLine, duration: number | undefined) => {
  const { workspace } = editorStore.state;
  if (workspace.kind === "closed") {
    return;
  }
  const { oto } = line.parsed;
  const end =
    oto.cutoff < 0
      ? oto.offset - oto.cutoff
      : (duration ?? Number.POSITIVE_INFINITY) - oto.cutoff;
  try {
    await playFileRange(
      await loadWavBlob(workspace.session.folder, oto.wav),
      oto.offset,
      end
    );
  } catch (error) {
    notify("error", `再生できません: ${errorText(error)}`);
  }
};

const showInTable = (group: DuplicateGroup, lineId: string) => {
  rowFilterStore.setState(() => new Set(group.lineIds));
  select(lineId);
  closeEditorPanel();
  notify(
    "info",
    `「${group.key}」の${group.lineIds.length}行を表示しています。`
  );
};

export const DuplicateDialog = () => {
  const present = usePresent();
  const durations = useSelector(durationStore, (state) => {
    const { workspace } = editorStore.state;
    return workspace.kind === "open"
      ? (state.get(workspace.session.folder) ?? EMPTY_DURATIONS)
      : EMPTY_DURATIONS;
  });
  const [ignore, setIgnore] = useState("");
  const [strategy, setStrategy] = useState<"first" | "last">("first");
  const [manual, setManual] = useState<Set<string> | null>(null);
  const [allowLastRow, setAllowLastRow] = useState(false);

  let pattern: RegExp | null = null;
  let patternError = "";
  try {
    pattern = ignore === "" ? null : new RegExp(ignore, "gu");
  } catch (error) {
    patternError = errorText(error);
  }
  const groups =
    present === null ? [] : findDuplicateGroups(present.otoSet, pattern);
  const lines = new Map(
    (present?.otoSet.lines ?? [])
      .filter(isOtoLine)
      .map((line) => [line.id, line])
  );
  const keep =
    manual ??
    new Set(
      groups.map(
        (group) =>
          (strategy === "last" ? group.lineIds.at(-1) : group.lineIds[0]) ?? ""
      )
    );
  const toggle = (id: string) => {
    const next = new Set(keep);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setManual(next);
  };
  const preview =
    present === null || patternError !== ""
      ? { result: null, error: patternError }
      : tryPreview(() =>
          removeDuplicates(present.otoSet, groups, keep, allowLastRow)
        );
  return (
    <EditorDialog
      title="重複エイリアスの整理"
      onClose={closeEditorPanel}
      className="max-w-5xl"
    >
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-slate-400">
          UTAUで呼ばれる名前（空欄はWAV名）が同じ行を、WAVが違っても1組にまとめます。残す行を選ぶと、ほかの行を削除します。値やコメントは合成しません。
        </p>
        <div className="grid grid-cols-2 items-start gap-2">
          <CommitTextField
            label="比較の前に名前から除く部分（正規表現、例: \d+$ で末尾の番号）"
            value={ignore}
            errorText={patternError}
            onCommit={(value) => {
              setIgnore(value);
              setManual(null);
            }}
          />
          <SelectField
            label="既定で残す行"
            value={strategy}
            options={[
              { id: "first", label: "iniで先にある行" },
              { id: "last", label: "iniで後にある行" },
            ]}
            onChange={(value) => {
              setStrategy(value);
              setManual(null);
            }}
          />
        </div>
        <p className="text-xs text-slate-300">
          {groups.length === 0
            ? "重複しているエイリアスはありません。"
            : `${groups.length}組`}
        </p>
        {groups.length > 0 ? (
          <div className="border-line max-h-80 overflow-auto rounded border">
            <table className="w-full text-xs tabular-nums">
              <caption className="sr-only">重複しているエイリアスの組</caption>
              <thead className="bg-panel sticky top-0 text-[11px] text-slate-400">
                <tr className="border-line border-b">
                  <th className="px-2 py-1.5 text-left font-normal">残す</th>
                  <th className="px-2 py-1.5 text-left font-normal">WAV</th>
                  <th className="px-2 py-1.5 text-left font-normal">
                    エイリアス
                  </th>
                  {PARAM_KEYS.map((key) => (
                    <th
                      key={key}
                      className="px-2 py-1.5 text-right font-normal whitespace-nowrap"
                    >
                      {PARAM_LABELS[key]}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-left font-normal">
                    注意・コメント
                  </th>
                  <th className="px-2 py-1.5 font-normal">
                    <span className="sr-only">確認</span>
                  </th>
                </tr>
              </thead>
              {groups.slice(0, GROUP_LIMIT).map((group) => (
                <tbody
                  key={group.key}
                  className="border-line border-b text-slate-200"
                >
                  {group.lineIds.map((id) => {
                    const line = lines.get(id);
                    if (line === undefined) {
                      return null;
                    }
                    const { oto } = line.parsed;
                    const duration = durations.get(oto.wav.toLowerCase());
                    const notes = [
                      ...line.parsed.issues,
                      ...(duration === undefined
                        ? paramWarnings(oto)
                        : rangeWarnings(oto, duration)),
                      line.comment ?? "",
                    ].filter((note) => note !== "");
                    return (
                      <tr key={id} className="border-b border-white/5">
                        <td className="px-2 py-1">
                          <Check
                            label="残す"
                            value={keep.has(id)}
                            onChange={() => {
                              toggle(id);
                            }}
                          />
                        </td>
                        <td className="max-w-40 truncate px-2 py-1 text-slate-400">
                          {oto.wav}
                        </td>
                        <th className="px-2 py-1 text-left font-normal whitespace-nowrap">
                          {oto.alias}
                        </th>
                        {PARAM_KEYS.map((key) => (
                          <td
                            key={key}
                            className="px-2 py-1 text-right font-mono"
                          >
                            {Number.isNaN(oto[key])
                              ? ""
                              : formatNumber(oto[key])}
                          </td>
                        ))}
                        <td
                          className="max-w-48 truncate px-2 py-1 text-slate-400"
                          title={notes.join("、")}
                        >
                          {notes.join("、")}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          <Button
                            tone="ghost"
                            aria-label="左ブランクから右ブランクまで試聴"
                            onPress={() => {
                              void audition(line, duration);
                            }}
                          >
                            <Play className="size-3.5" />
                          </Button>
                          <Button
                            tone="ghost"
                            aria-label="この組を一覧に表示して波形で確認"
                            onPress={() => {
                              showInTable(group, id);
                            }}
                          >
                            <Eye className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
            {groups.length > GROUP_LIMIT ? (
              <p className="px-2 py-1 text-[11px] text-slate-500">
                ほか{groups.length - GROUP_LIMIT}組（既定で残す行に従います）
              </p>
            ) : null}
          </div>
        ) : null}
        <Check
          label="WAVの最後の行も削除する"
          value={allowLastRow}
          onChange={setAllowLastRow}
        />
        <BatchPreview {...preview} applyLabel="削除" />
      </div>
    </EditorDialog>
  );
};
