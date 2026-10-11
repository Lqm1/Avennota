import { CELL_COLUMNS } from "./cell-selection";
import type { CellColumn, CellPoint } from "./cell-selection";
import type { OtoRow } from "./rows";

export interface CellEdit {
  cell: CellPoint;
  text: string;
}
export type TableRow = OtoRow & {
  selectedColumns: CellColumn[];
  activeColumn: CellColumn | null;
  editing: CellEdit | null;
};
const rowCache = new WeakMap<OtoRow, TableRow>();

/** 選択・入力が変わった行だけ、仮想化テーブルのキャッシュを更新する。 */
export const buildTableRows = (
  rows: OtoRow[],
  cells: CellPoint[],
  active: CellPoint | null,
  editing: CellEdit | null
): TableRow[] => {
  const selected = new Set(
    cells.map((cell) => `${cell.lineId}:${cell.column}`)
  );
  return rows.map((row) => {
    const cached = rowCache.get(row);
    const selectedColumns = CELL_COLUMNS.filter((column) =>
      selected.has(`${row.id}:${column}`)
    );
    const activeColumn = active?.lineId === row.id ? active.column : null;
    const edit = editing?.cell.lineId === row.id ? editing : null;
    if (
      cached !== undefined &&
      cached.activeColumn === activeColumn &&
      cached.editing === edit &&
      cached.selectedColumns.length === selectedColumns.length &&
      cached.selectedColumns.every(
        (column, index) => column === selectedColumns[index]
      )
    ) {
      return cached;
    }
    const result = { ...row, selectedColumns, activeColumn, editing: edit };
    rowCache.set(row, result);
    return result;
  });
};
