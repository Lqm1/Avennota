import { cn } from "cn";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import {
  Cell,
  Column,
  Row,
  Table,
  TableBody,
  TableHeader,
  TableLayout,
  Virtualizer,
  Input,
} from "react-aria-components";

import {
  fileStem,
  formatNumber,
  PARAM_LABELS,
  PARAM_KEYS,
} from "../oto/oto-set";
import type { ParamKey } from "../oto/oto-set";
import { editCell, acceptsCellNumber } from "./bulk-edit";
import { clipboardAction } from "./cell-clipboard";
import {
  CELL_COLUMNS,
  cellSelectionStore,
  isTextColumn,
  selectCell,
  selectedCells,
  useCellSelection,
} from "./cell-selection";
import type { CellColumn, CellPoint } from "./cell-selection";
import { tableCommand } from "./keyboard-commands";
import { ParamSwatch } from "./param-swatch";
import type { OtoRow, ParsedOtoRow, RowStatusTone } from "./rows";
import { settingsStore } from "./settings";
import { select, editorStore, transformOtoSet } from "./store";
import { TableMenu } from "./table-menu";
import { buildTableRows } from "./table-rows";

const ROW_HEIGHT = 26;
const fillSlot = { height: "inherit", width: "inherit" } as const;
const HEADING_HEIGHT = 28;

export const statusToneClass: Record<RowStatusTone, string> = {
  error: "text-red-300",
  info: "text-slate-400",
  warning: "text-amber-300",
};

interface OtoTableProps {
  rows: OtoRow[];
  selectedId: string | null;
}

const PARAM_COLUMNS = CELL_COLUMNS.filter(
  (column): column is ParamKey => column !== "wav" && !isTextColumn(column)
);

const cellClass =
  "truncate px-2 outline-none data-focus-visible:ring-2 data-focus-visible:ring-accent data-focus-visible:ring-inset";

const cursorDirection = (event: KeyboardEvent): number => {
  if (event.altKey || event.shiftKey) {
    return 0;
  }
  if (
    event.key === "ArrowLeft" ||
    ((event.ctrlKey || event.metaKey) && ["h", "b"].includes(event.key))
  ) {
    return -1;
  }
  if (
    event.key === "ArrowRight" ||
    ((event.ctrlKey || event.metaKey) && event.key === "l")
  ) {
    return 1;
  }
  return 0;
};
const moveInputCursor = (
  event: KeyboardEvent,
  move: (row: number, column: number) => void
): boolean => {
  const direction = cursorDirection(event);
  if (!(event.target instanceof HTMLInputElement) || direction === 0) {
    return false;
  }
  const input = event.target;
  const position = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? position;
  event.preventDefault();
  event.stopPropagation();
  if (
    position === end &&
    ((direction === -1 && position === 0) ||
      (direction === 1 && position === input.value.length))
  ) {
    move(0, direction);
  } else {
    let next = position + direction;
    if (position < end) {
      next = direction === -1 ? position : end;
    }
    input.setSelectionRange(next, next);
  }
  return true;
};

const choose = (point: CellPoint, extend = false) => {
  selectCell(point, extend);
  select(point.lineId);
};
const pointAt = (target: EventTarget | null): CellPoint | null => {
  if (!(target instanceof Element)) {
    return null;
  }
  const element = target.closest<HTMLElement>("[data-cell-column]");
  const column = CELL_COLUMNS.find(
    (candidate) => candidate === element?.dataset.cellColumn
  );
  const lineId = element?.dataset.lineId;
  return column !== undefined && lineId !== undefined
    ? { column, lineId }
    : null;
};
const cellNumber = (row: OtoRow, key: ParamKey): string => {
  if (row.kind !== "oto") {
    return "";
  }
  const value = row.line.parsed.oto[key];
  const token = row.line.parsed.oto.paramTexts[PARAM_KEYS.indexOf(key)];
  if (token === "" || token === "-") {
    return token;
  }
  return Number.isFinite(value) ? formatNumber(value) : "";
};
const editText = (
  row: ParsedOtoRow,
  column: Exclude<CellColumn, "wav">
): string => {
  if (column === "alias") {
    return row.line.parsed.oto.alias;
  }
  if (column === "comment") {
    return row.line.comment ?? "";
  }
  return cellNumber(row, column);
};
const useTableKeyboard = (
  ref: React.RefObject<HTMLTableElement | null>,
  handler: (event: KeyboardEvent) => void
) => {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const element = ref.current;
    const keydown = (event: KeyboardEvent) => {
      latest.current(event);
    };
    element?.addEventListener("keydown", keydown, true);
    return () => {
      element?.removeEventListener("keydown", keydown, true);
    };
  }, [ref]);
};

const AliasText = ({ row }: { row: OtoRow }) => {
  if (row.kind === "unparsed") {
    return <span className="font-mono text-amber-200/80">{row.line.text}</span>;
  }
  const { oto } = row.line.parsed;
  return oto.alias === "" ? (
    <span className="text-slate-500">（{fileStem(oto.wav)}）</span>
  ) : (
    oto.alias
  );
};

const OtoTableView = ({ rows, selectedId }: OtoTableProps) => {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const selection = useCellSelection();
  const [editing, setEditing] = useState<{
    cell: CellPoint;
    text: string;
  } | null>(null);
  const dragging = useRef(false);
  const latestEditing = useRef(editing);
  useLayoutEffect(() => {
    latestEditing.current = editing;
  });
  const focusRequested = useRef(false);
  const cursorRequested = useRef<number | "end" | null>(null);
  const focusEditorInput = useCallback((input: HTMLInputElement | null) => {
    if (input !== null && cursorRequested.current !== null) {
      const position =
        cursorRequested.current === "end"
          ? input.value.length
          : cursorRequested.current;
      input.focus();
      input.setSelectionRange(position, position);
      cursorRequested.current = null;
      focusRequested.current = false;
    }
  }, []);
  const { workspace } = editorStore.state;
  const cells =
    workspace.kind === "open"
      ? selectedCells(workspace.history.present.otoSet, selection, selectedId)
      : [];
  const active = useMemo(
    () =>
      selection?.active ??
      (selectedId === null
        ? null
        : { lineId: selectedId, column: "alias" as const }),
    [selection, selectedId]
  );
  const tableRows = buildTableRows(rows, cells, active, editing);
  const commitEdit = () => {
    setEditing(null);
  };
  const changeEditText = (cell: CellPoint, text: string) => {
    transformOtoSet((source) =>
      editCell(
        source,
        cell,
        text,
        settingsStore.state.offsetMode === "positions"
      )
    );
    const current = editorStore.state.workspace;
    const line =
      current.kind === "open"
        ? current.history.present.otoSet.lines.find(
            (candidate) => candidate.id === cell.lineId
          )
        : undefined;
    let shown = text;
    if (
      line?.parsed.kind === "oto" &&
      cell.column !== "wav" &&
      !isTextColumn(cell.column)
    ) {
      shown =
        line.parsed.oto.paramTexts[PARAM_KEYS.indexOf(cell.column)] ?? text;
    }
    setEditing({ cell, text: shown });
  };
  const move = (rowDelta: number, columnDelta: number, extend = false) => {
    if (active === null) {
      return;
    }
    const rowIndex = rows.findIndex((row) => row.id === active.lineId);
    const row =
      rows[Math.min(rows.length - 1, Math.max(0, rowIndex + rowDelta))];
    const column =
      CELL_COLUMNS[
        Math.min(
          CELL_COLUMNS.length - 1,
          Math.max(0, CELL_COLUMNS.indexOf(active.column) + columnDelta)
        )
      ];
    if (row !== undefined && column !== undefined) {
      commitEdit();
      focusRequested.current = true;
      choose({ lineId: row.id, column }, extend);
      if (!extend && row.kind === "oto" && column !== "wav") {
        const text = editText(row, column);
        cursorRequested.current = columnDelta < 0 ? "end" : 0;
        setEditing({ cell: { lineId: row.id, column }, text });
      }
    }
  };
  useLayoutEffect(() => {
    if (!focusRequested.current || active === null || editing !== null) {
      return;
    }
    const element = tableRef.current?.querySelector<HTMLElement>(
      `[data-line-id="${CSS.escape(active.lineId)}"][data-cell-column="${active.column}"]`
    );
    if (element) {
      element.focus();
      focusRequested.current = false;
    }
  }, [active, editing]);
  const startEdit = (point: CellPoint, initial?: string) => {
    const row = rows.find((candidate) => candidate.id === point.lineId);
    if (row?.kind !== "oto" || point.column === "wav") {
      return;
    }
    if (
      !isTextColumn(point.column) &&
      initial !== undefined &&
      !acceptsCellNumber(initial)
    ) {
      return;
    }
    choose(point);
    if (initial !== undefined) {
      changeEditText(point, initial);
      return;
    }
    setEditing({ cell: point, text: editText(row, point.column) });
  };
  useTableKeyboard(tableRef, (event) => {
    if (event.isComposing || active === null) {
      return;
    }
    if (editing !== null && moveInputCursor(event, move)) {
      return;
    }
    const command = tableCommand(event, editing !== null);
    if (command === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (command.kind === "clipboard") {
      commitEdit();
      void clipboardAction(command.action, active, selectedId);
    }
    if (command.kind === "move") {
      move(command.row, command.column, event.shiftKey && event.key !== "Tab");
    }
    if (command.kind === "cancel") {
      setEditing(null);
    }
    if (command.kind === "type") {
      startEdit(active, command.text);
    }
  });
  useEffect(() => {
    const release = () => {
      dragging.current = false;
    };
    window.addEventListener("pointerup", release);
    return () => {
      window.removeEventListener("pointerup", release);
    };
  }, []);
  useEffect(() => {
    const subscription = editorStore.subscribe(({ workspace: current }) => {
      const currentEdit = latestEditing.current;
      const targetId =
        current.kind === "open" ? current.history.present.selectedId : null;
      if (
        currentEdit === null ||
        targetId === null ||
        currentEdit.cell.lineId === targetId
      ) {
        return;
      }
      const target =
        current.kind === "open"
          ? current.history.present.otoSet.lines.find(
              (line) => line.id === targetId
            )
          : undefined;
      const { column } = currentEdit.cell;
      if (target?.parsed.kind === "oto" && column !== "wav") {
        let text = target.comment ?? "";
        if (column === "alias") {
          text = target.parsed.oto.alias;
        } else if (column !== "comment") {
          text =
            target.parsed.oto.paramTexts[PARAM_KEYS.indexOf(column)] ??
            formatNumber(target.parsed.oto[column]);
        }
        cursorRequested.current = 0;
        setEditing({ cell: { lineId: targetId, column }, text });
      } else {
        setEditing(null);
        focusRequested.current = true;
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (
      selectedId !== null &&
      cellSelectionStore.state?.active.lineId !== selectedId
    ) {
      selectCell({
        lineId: selectedId,
        column: cellSelectionStore.state?.active.column ?? "alias",
      });
    }
  }, [selectedId]);

  useEffect(() => {
    const table = tableRef.current;
    const index = rows.findIndex((row) => row.id === selectedId);
    if (!table || index === -1) {
      return;
    }
    const top = index * ROW_HEIGHT;
    const viewTop = table.scrollTop;
    const viewHeight = table.clientHeight - HEADING_HEIGHT;
    if (top < viewTop) {
      table.scrollTop = top;
    } else if (top + ROW_HEIGHT > viewTop + viewHeight) {
      table.scrollTop = top + ROW_HEIGHT - viewHeight;
    }
  }, [rows, selectedId]);

  return (
    <>
      <Virtualizer
        layout={TableLayout}
        layoutOptions={{ headingHeight: HEADING_HEIGHT, rowHeight: ROW_HEIGHT }}
      >
        <Table
          aria-label="原音設定一覧"
          className="h-full w-full overflow-auto text-xs outline-none"
          data-oto-table
          onPointerDownCapture={(event) => {
            const point = pointAt(event.target);
            if (
              point !== null &&
              event.button === 0 &&
              !(event.target instanceof HTMLInputElement)
            ) {
              commitEdit();
              choose(point, event.shiftKey);
              dragging.current = true;
            }
          }}
          onPointerMove={(event) => {
            const point = pointAt(event.target);
            if (dragging.current && point !== null) {
              choose(point, true);
            }
          }}
          onDoubleClick={(event) => {
            const point = pointAt(event.target);
            if (point !== null) {
              startEdit(point);
            }
          }}
          onPointerUp={(event) => {
            const point = pointAt(event.target);
            const current = cellSelectionStore.state;
            if (
              event.button === 0 &&
              !event.shiftKey &&
              dragging.current &&
              point !== null &&
              current !== null &&
              current.anchor.lineId === current.active.lineId &&
              current.anchor.column === current.active.column &&
              !(event.target instanceof HTMLInputElement)
            ) {
              startEdit(point);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            commitEdit();
            setContextMenu({
              x: Math.max(0, Math.min(event.clientX, window.innerWidth - 260)),
              y: Math.max(0, Math.min(event.clientY, window.innerHeight - 320)),
            });
          }}
          disallowEmptySelection
          onSelectionChange={(keys) => {
            if (keys !== "all") {
              const [first] = keys;
              if (first !== undefined && !dragging.current) {
                select(String(first));
              }
            }
          }}
          ref={tableRef}
          selectedKeys={selectedId === null ? [] : [selectedId]}
          selectionBehavior="replace"
          selectionMode="single"
        >
          <TableHeader
            className="bg-panel text-[11px] text-slate-400"
            style={fillSlot}
          >
            <Column
              className="px-2 text-right font-normal"
              defaultWidth={52}
              id="line"
            >
              行
            </Column>
            <Column
              className="px-2 text-left font-normal"
              defaultWidth={150}
              id="wav"
            >
              WAV
            </Column>
            {PARAM_COLUMNS.map((key) => (
              <Column
                className="px-2 text-right font-normal whitespace-nowrap"
                defaultWidth={104}
                id={key}
                key={key}
              >
                <span className="inline-flex max-w-full items-center gap-1">
                  <ParamSwatch className="shrink-0" param={key} />
                  <span className="truncate">{PARAM_LABELS[key]}</span>
                </span>
              </Column>
            ))}
            <Column
              className="px-2 text-left font-normal"
              defaultWidth={130}
              id="alias"
              isRowHeader
            >
              エイリアス
            </Column>
            <Column
              className="px-2 text-left font-normal"
              defaultWidth={160}
              id="comment"
            >
              コメント
            </Column>
            <Column
              className="px-2 text-left font-normal"
              defaultWidth={260}
              id="status"
            >
              状態
            </Column>
          </TableHeader>
          <TableBody items={tableRows}>
            {(row) => (
              <Row
                style={fillSlot}
                className="data-selected:bg-accent/25 cursor-default border-b border-white/5 text-slate-200 outline-none data-focus-visible:bg-white/5 data-hovered:bg-white/5"
                id={row.id}
              >
                <Cell
                  className={cn(
                    cellClass,
                    "text-right font-mono text-slate-500 tabular-nums"
                  )}
                >
                  {row.lineNumber}
                </Cell>
                <Cell
                  className={cn(
                    cellClass,
                    row.selectedColumns.includes("wav") && "bg-accent/20"
                  )}
                  data-cell-column="wav"
                  data-line-id={row.id}
                >
                  {row.kind === "oto" ? row.line.parsed.oto.wav : ""}
                </Cell>
                {PARAM_COLUMNS.map((key) => (
                  <Cell
                    className={cn(
                      cellClass,
                      "text-right font-mono tabular-nums",
                      row.selectedColumns.includes(key) && "bg-accent/20",
                      row.activeColumn === key &&
                        "ring-accent ring-1 ring-inset"
                    )}
                    key={key}
                    data-cell-column={key}
                    data-line-id={row.id}
                  >
                    {row.editing?.cell.column === key ? (
                      <Input
                        ref={focusEditorInput}
                        autoFocus
                        aria-label={`${row.lineNumber}行目 ${PARAM_LABELS[key]}`}
                        className="w-full bg-black/30 font-mono outline-none"
                        value={row.editing.text}
                        onChange={(event) => {
                          if (acceptsCellNumber(event.target.value)) {
                            changeEditText(
                              { lineId: row.id, column: key },
                              event.target.value
                            );
                          }
                        }}
                        onBlur={commitEdit}
                      />
                    ) : (
                      cellNumber(row, key)
                    )}
                  </Cell>
                ))}
                <Cell
                  className={cn(
                    cellClass,
                    row.selectedColumns.includes("alias") && "bg-accent/20",
                    row.activeColumn === "alias" &&
                      "ring-accent ring-1 ring-inset"
                  )}
                  data-cell-column="alias"
                  data-line-id={row.id}
                >
                  {row.editing?.cell.column === "alias" ? (
                    <Input
                      ref={focusEditorInput}
                      autoFocus
                      aria-label={`${row.lineNumber}行目 エイリアス`}
                      className="w-full bg-black/30 outline-none"
                      value={row.editing.text}
                      onChange={(event) => {
                        changeEditText(
                          { lineId: row.id, column: "alias" },
                          event.target.value
                        );
                      }}
                      onBlur={commitEdit}
                    />
                  ) : (
                    <AliasText row={row} />
                  )}
                </Cell>
                <Cell
                  className={cn(
                    cellClass,
                    row.selectedColumns.includes("comment") && "bg-accent/20",
                    row.activeColumn === "comment" &&
                      "ring-accent ring-1 ring-inset"
                  )}
                  data-cell-column="comment"
                  data-line-id={row.id}
                >
                  {row.editing?.cell.column === "comment" ? (
                    <Input
                      ref={focusEditorInput}
                      autoFocus
                      aria-label={`${row.lineNumber}行目 コメント`}
                      className="w-full bg-black/30 outline-none"
                      value={row.editing.text}
                      onChange={(event) => {
                        changeEditText(
                          { lineId: row.id, column: "comment" },
                          event.target.value
                        );
                      }}
                      onBlur={commitEdit}
                    />
                  ) : (
                    row.line.comment
                  )}
                </Cell>
                <Cell className={cellClass}>
                  {row.statuses.map((status) => (
                    <span
                      className={cn("mr-2", statusToneClass[status.tone])}
                      key={status.text}
                    >
                      {status.text}
                    </span>
                  ))}
                </Cell>
              </Row>
            )}
          </TableBody>
        </Table>
      </Virtualizer>
      {contextMenu === null ? null : (
        <TableMenu
          position={contextMenu}
          onClose={() => {
            setContextMenu(null);
          }}
        />
      )}
    </>
  );
};

export const OtoTable = memo(OtoTableView);
