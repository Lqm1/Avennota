import { copyCells, pasteCells, changeCells } from "./bulk-edit";
import { cellSelectionStore, selectedCells } from "./cell-selection";
import type { CellPoint } from "./cell-selection";
import { settingsStore } from "./settings";
import { ask, editorStore, errorText, transformOtoSet, notify } from "./store";

export const clipboardAction = async (
  action: "copy" | "cut" | "paste",
  active: CellPoint,
  selectedId: string | null
) => {
  const { workspace } = editorStore.state;
  if (workspace.kind === "closed") {
    return;
  }
  const { otoSet } = workspace.history.present;
  const selected = selectedCells(otoSet, cellSelectionStore.state, selectedId);
  try {
    if (action === "paste") {
      const text = await navigator.clipboard.readText();
      const targets = selected.length === 0 ? [active] : selected;
      const matrix = text
        .trimEnd()
        .split(/\r?\n/u)
        .map((row) => row.split(row.includes("\t") ? "\t" : ","));
      const height = new Set(targets.map((cell) => cell.lineId)).size;
      const width = new Set(targets.map((cell) => cell.column)).size;
      if (
        (matrix.length > 1 || (matrix[0]?.length ?? 0) > 1) &&
        (matrix.length !== height || matrix[0]?.length !== width) &&
        (await ask({
          title: "貼り付け範囲の確認",
          message:
            "コピー内容と選択範囲の大きさが異なります。選択範囲へ繰り返して貼り付けますか？",
          actions: [
            { id: "paste", label: "貼り付ける", tone: "primary" },
            { id: "cancel", label: "キャンセル" },
          ],
        })) !== "paste"
      ) {
        return;
      }
      transformOtoSet((source) => pasteCells(source, targets, text));
    } else {
      await navigator.clipboard.writeText(
        copyCells(
          otoSet,
          selected,
          settingsStore.state.advanced.clipboardFormat === "tsv" ? "\t" : ","
        )
      );
      if (action === "cut") {
        transformOtoSet((source) =>
          changeCells(source, selected, {
            mode: "set",
            value: "",
            condition: "all",
            threshold: 0,
          })
        );
      }
    }
  } catch (error) {
    notify("error", `クリップボードを操作できません: ${errorText(error)}`);
  }
};
