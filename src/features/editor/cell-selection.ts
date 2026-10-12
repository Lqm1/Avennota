import { createStore, useSelector } from "@tanstack/react-store";

import type { OtoSet } from "../oto/oto-set";
import { visibleLines } from "./row-filter";

export const CELL_COLUMNS = [
  "wav",
  "offset",
  "overlap",
  "preutter",
  "consonant",
  "cutoff",
  "alias",
  "comment",
] as const;
export type CellColumn = (typeof CELL_COLUMNS)[number];
export const isTextColumn = (
  column: CellColumn
): column is "alias" | "comment" => column === "alias" || column === "comment";
export interface CellPoint {
  lineId: string;
  column: CellColumn;
}
export interface CellSelection {
  anchor: CellPoint;
  active: CellPoint;
}
export const cellSelectionStore = createStore<CellSelection | null>(null);
export const useCellSelection = () =>
  useSelector(cellSelectionStore, (state) => state);
export const selectCell = (point: CellPoint, extend = false): void => {
  cellSelectionStore.setState((state) => ({
    anchor: extend && state !== null ? state.anchor : point,
    active: point,
  }));
};
export const selectedCells = (
  otoSet: OtoSet,
  selection: CellSelection | null,
  fallbackId: string | null
): CellPoint[] => {
  if (selection === null) {
    return fallbackId === null ? [] : [{ lineId: fallbackId, column: "alias" }];
  }
  const lines = visibleLines(otoSet);
  const a = lines.findIndex((line) => line.id === selection.anchor.lineId);
  const b = lines.findIndex((line) => line.id === selection.active.lineId);
  if (a === -1 || b === -1) {
    return fallbackId === null ? [] : [{ lineId: fallbackId, column: "alias" }];
  }
  const ca = CELL_COLUMNS.indexOf(selection.anchor.column);
  const cb = CELL_COLUMNS.indexOf(selection.active.column);
  return lines
    .slice(Math.min(a, b), Math.max(a, b) + 1)
    .flatMap((line) =>
      CELL_COLUMNS.slice(Math.min(ca, cb), Math.max(ca, cb) + 1).map(
        (column) => ({ lineId: line.id, column })
      )
    );
};
