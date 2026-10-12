export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}
export type EditorCommand =
  | "next"
  | "previous"
  | "nextWav"
  | "previousWav"
  | "left"
  | "right"
  | "pageLeft"
  | "pageRight"
  | "start"
  | "play"
  | "range"
  | "visible"
  | "stop"
  | "timing"
  | "trim"
  | "zoomIn"
  | "zoomOut"
  | "reload"
  | "toggleP"
  | "toggleS"
  | "offsetPositions"
  | "bulk"
  | "duplicate"
  | "delete";
const mainKeys: Readonly<Record<string, EditorCommand>> = {
  "2": "next",
  j: "next",
  s: "next",
  ArrowDown: "next",
  "8": "previous",
  k: "previous",
  w: "previous",
  ArrowUp: "previous",
  "4": "left",
  a: "left",
  h: "left",
  ArrowLeft: "left",
  "6": "right",
  d: "right",
  l: "right",
  ArrowRight: "right",
  "5": "play",
  " ": "play",
  q: "start",
  PageUp: "pageLeft",
  PageDown: "pageRight",
  F11: "zoomOut",
  F12: "zoomIn",
  c: "reload",
  P: "toggleP",
  L: "toggleS",
};
const controlCommand = (
  event: KeyInput,
  table: boolean
): EditorCommand | null => {
  if (event.key === " ") {
    return event.shiftKey ? "visible" : "range";
  }
  if (event.key.toLowerCase() === "p") {
    return event.altKey ? "range" : "play";
  }
  if (event.altKey || event.shiftKey) {
    return null;
  }
  if (event.key.toLowerCase() === "m") {
    return "bulk";
  }
  if (table && event.key.toLowerCase() === "i") {
    return "duplicate";
  }
  if (table && event.key.toLowerCase() === "d") {
    return "delete";
  }
  return null;
};
const altKeys: Readonly<Record<string, EditorCommand>> = {
  ArrowDown: "nextWav",
  ArrowUp: "previousWav",
};
const columnKeys: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowRight: 1,
};
export const editorCommand = (
  event: KeyInput,
  table: boolean
): EditorCommand | null => {
  if (event.key === "F8") {
    return "timing";
  }
  if (event.key === "F9") {
    return "trim";
  }
  if (event.key === "F10") {
    return null;
  }
  if (event.key === "Escape") {
    return "stop";
  }
  if (event.key === "F6") {
    return event.altKey ? "nextWav" : "next";
  }
  if (event.key === "F7") {
    return event.altKey ? "previousWav" : "previous";
  }
  if (event.ctrlKey || event.metaKey) {
    if (event.shiftKey && event.key.toLowerCase() === "l" && !table) {
      return "offsetPositions";
    }
    return controlCommand(event, table);
  }
  if (event.altKey) {
    return altKeys[event.key] ?? null;
  }
  if (table) {
    return event.shiftKey && event.key === " " ? "play" : null;
  }
  return mainKeys[event.key] ?? null;
};
export type TableCommand =
  | { kind: "move"; row: number; column: number }
  | { kind: "clipboard"; action: "copy" | "cut" | "paste" }
  | { kind: "cancel" }
  | { kind: "type"; text: string };
export const tableCommand = (
  event: KeyInput,
  editing: boolean
): TableCommand | null => {
  const control = event.ctrlKey || event.metaKey;
  if (control) {
    if (!editing && ["h", "b", "l"].includes(event.key)) {
      return { kind: "move", row: 0, column: event.key === "l" ? 1 : -1 };
    }
    const actions = { c: "copy", x: "cut", v: "paste" } as const;
    const action = Object.entries(actions).find(
      ([key]) => key === event.key.toLowerCase()
    )?.[1];
    if (action !== undefined) {
      return { kind: "clipboard", action };
    }
  }
  const rowKeys: Record<string, number> = control
    ? { j: 1, k: -1, u: -1 }
    : { ArrowDown: 1, ArrowUp: -1, Enter: 1 };
  const row = rowKeys[event.key];
  if (row !== undefined) {
    return { kind: "move", row, column: 0 };
  }
  if (event.key === "Tab") {
    return { kind: "move", row: 0, column: event.shiftKey ? -1 : 1 };
  }
  if (event.altKey) {
    const column = columnKeys[event.key];
    return column === undefined ? null : { kind: "move", row: 0, column };
  }
  if (editing && event.key === "Escape") {
    return { kind: "cancel" };
  }
  if (!editing && !control) {
    const column = columnKeys[event.key];
    if (column !== undefined) {
      return { kind: "move", row: 0, column };
    }
    if (event.key.length === 1) {
      return { kind: "type", text: event.key };
    }
  }
  return null;
};
