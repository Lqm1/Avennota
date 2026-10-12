import { moveOffset } from "../oto/geometry";
import {
  effectiveAlias,
  fileStem,
  formatNumber,
  replaceLine,
  setLineOto,
  withParams,
  PARAM_KEYS,
} from "../oto/oto-set";
import type { Oto, OtoSet } from "../oto/oto-set";
import { deleteLines } from "./batch";
import { CELL_COLUMNS } from "./cell-selection";
import type { CellPoint } from "./cell-selection";

export const acceptsCellNumber = (text: string): boolean =>
  text === "" ||
  text === "-" ||
  (!/\s/u.test(text) &&
    Number.isFinite(Number(text)) &&
    Math.abs(Number(text)) <= 1_000_000);

export const withCellText = (
  oto: Oto,
  column: CellPoint["column"],
  text: string
): Oto => {
  if (column === "wav" || column === "comment") {
    return oto;
  }
  if (column === "alias") {
    return { ...oto, alias: text };
  }
  if (text === "" || text === "-") {
    const paramTexts = [...oto.paramTexts];
    while (paramTexts.length < PARAM_KEYS.length) {
      paramTexts.push("0");
    }
    paramTexts[PARAM_KEYS.indexOf(column)] = text;
    return { ...oto, [column]: text === "" ? 0 : Number.NaN, paramTexts };
  }
  if (!acceptsCellNumber(text)) {
    return oto;
  }
  const value = Number(text);
  const number = Math.trunc(value * 1000) / 1000;
  const next = withParams(oto, { [column]: number });
  const index = PARAM_KEYS.indexOf(column);
  const token = formatNumber(number);
  if (next.paramTexts[index] === token) {
    return next;
  }
  const paramTexts = [...next.paramTexts];
  while (paramTexts.length <= index) {
    paramTexts.push("0");
  }
  paramTexts[index] = token;
  return { ...next, paramTexts };
};

/** セル入力の左ブランクは、マウス連動とは別に他の絶対位置を維持する。 */
export const editCell = (
  source: OtoSet,
  cell: CellPoint,
  text: string,
  preservePositions: boolean
): OtoSet =>
  replaceLine(source, cell.lineId, (line) => {
    if (line.parsed.kind !== "oto") {
      return line;
    }
    if (cell.column === "comment") {
      const comment = text.replaceAll(/\r?\n/gu, " ");
      return comment === (line.comment ?? "") ? line : { ...line, comment };
    }
    const original = line.parsed.oto;
    let oto = withCellText(original, cell.column, text);
    if (
      cell.column === "offset" &&
      preservePositions &&
      oto !== original &&
      text !== "" &&
      Number.isFinite(oto.offset) &&
      Number.isFinite(original.offset)
    ) {
      const moved = moveOffset(original, oto.offset);
      const changes: Partial<Oto> = {};
      for (const column of [
        "consonant",
        "preutter",
        "overlap",
        "cutoff",
      ] as const) {
        const token = original.paramTexts[PARAM_KEYS.indexOf(column)];
        if (
          token !== undefined &&
          token !== "" &&
          Number.isFinite(original[column])
        ) {
          changes[column] = moved[column];
        }
      }
      oto = withParams(oto, changes);
    }
    return setLineOto(line, oto);
  });

export interface BulkChange {
  mode: "set" | "add" | "subtract" | "integer";
  value: string;
  condition: "all" | "equal" | "atLeast" | "atMost";
  threshold: number;
}
export const changeCells = (
  source: OtoSet,
  cells: CellPoint[],
  change: BulkChange
): OtoSet => {
  let next = source;
  for (const { lineId, column } of cells) {
    if (column === "wav") {
      continue;
    }
    next = replaceLine(next, lineId, (line) => {
      if (line.parsed.kind !== "oto") {
        return line;
      }
      const { oto } = line.parsed;
      if (column === "comment") {
        return change.mode === "set"
          ? { ...line, comment: change.value }
          : line;
      }
      if (column === "alias") {
        return change.mode === "set"
          ? setLineOto(line, { ...oto, alias: change.value })
          : line;
      }
      const current = Number.isFinite(oto[column]) ? oto[column] : 0;
      if (
        (change.condition === "equal" && current !== change.threshold) ||
        (change.condition === "atLeast" && current < change.threshold) ||
        (change.condition === "atMost" && current > change.threshold)
      ) {
        return line;
      }
      const value = Number(change.value);
      if (!Number.isFinite(value)) {
        return line;
      }
      let result = value;
      if (change.mode === "add") {
        result = current + value;
      }
      if (change.mode === "subtract") {
        result = current - value;
      }
      if (change.mode === "integer") {
        result = Math.trunc(current);
      }
      return setLineOto(
        line,
        withCellText(
          oto,
          column,
          change.mode === "set" && change.value === "" ? "" : String(result)
        )
      );
    });
  }
  return next;
};

export const copyCells = (
  source: OtoSet,
  cells: CellPoint[],
  delimiter = ","
): string => {
  const byRow = new Map<string, string[]>();
  for (const { lineId, column } of cells) {
    const line = source.lines.find((candidate) => candidate.id === lineId);
    if (line?.parsed.kind !== "oto") {
      continue;
    }
    const values = byRow.get(lineId) ?? [];
    if (column === "comment") {
      values.push(line.comment ?? "");
      byRow.set(lineId, values);
      continue;
    }
    const value = line.parsed.oto[column];
    let text = typeof value === "number" ? formatNumber(value) : value;
    if (column !== "wav" && column !== "alias") {
      const token = line.parsed.oto.paramTexts[PARAM_KEYS.indexOf(column)];
      if (token === "" || token === "-") {
        text = token;
      }
    }
    if (column === "wav" && typeof value === "string") {
      text = fileStem(value);
    }
    values.push(text);
    byRow.set(lineId, values);
  }
  return `${[...byRow.values()].map((values) => values.join(delimiter)).join("\n")}\n`;
};
export const pasteCells = (
  source: OtoSet,
  cells: CellPoint[],
  text: string
): OtoSet => {
  const rowIds = [...new Set(cells.map((cell) => cell.lineId))];
  const columns = CELL_COLUMNS.filter((column) =>
    cells.some((cell) => cell.column === column)
  );
  let next = source;
  const rows = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/\n$/u, "")
    .split("\n")
    .map((row) => row.split(row.includes("\t") ? "\t" : ","));
  for (const cell of cells) {
    const values = rows[rowIds.indexOf(cell.lineId) % rows.length] ?? [];
    const value = values[columns.indexOf(cell.column) % values.length] ?? "";
    next = editCell(next, cell, value, false);
  }
  return next;
};

const KANA = new Set(
  "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゃゅょぁぃぅぇぉゎっゐゑ" +
    "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポャュョァィゥェォヮッヰヱヴ゛゜°ー・"
);
const splitName = (name: string): [string, string] => {
  const trimmed = name.trim();
  const prefix = /^(?<lead>[^ ]+ )(?<body>.+)$/u.exec(trimmed);
  const lead = prefix?.groups?.lead ?? "";
  const body = prefix?.groups?.body ?? trimmed;
  const kana = KANA.has(body[0] ?? "");
  let length = 0;
  for (const char of body) {
    if (kana ? KANA.has(char) : /^[a-zA-Z\-'*]$/u.test(char)) {
      length += char.length;
    } else {
      break;
    }
  }
  return [lead + body.slice(0, length), body.slice(length)];
};
export interface AliasChange {
  rule: string;
  deletePrefix: number;
  deleteSuffix: number;
  maxDuplicates: number;
}
/** %m/%s/%f/%a/%rと、重複上限超過行の削除を適用する。 */
export const changeAliases = (
  source: OtoSet,
  ids: ReadonlySet<string>,
  change: AliasChange
): OtoSet => {
  if (change.rule === "") {
    return source;
  }
  let next = source;
  const counts = new Map<string, number>();
  const deletions: string[] = [];
  for (const line of source.lines) {
    if (!ids.has(line.id) || line.parsed.kind !== "oto") {
      continue;
    }
    const { oto } = line.parsed;
    const [name, suffix] = splitName(effectiveAlias(oto));
    const chars = oto.alias.slice(change.deletePrefix);
    const alias = chars.slice(
      0,
      Math.max(0, chars.length - change.deleteSuffix)
    );
    const rule = change.rule
      .replaceAll("%m", name)
      .replaceAll("%s", suffix)
      .replaceAll("%f", fileStem(oto.wav))
      .replaceAll("%a", alias);
    const count = (counts.get(rule) ?? 0) + 1;
    counts.set(rule, count);
    const overLimit = change.maxDuplicates > 0 && count > change.maxDuplicates;
    if (rule.includes("%r") && overLimit) {
      deletions.push(line.id);
    }
    next = replaceLine(next, line.id, (original) =>
      setLineOto(original, {
        ...oto,
        alias: rule.replaceAll(
          "%r",
          count === 1 || overLimit ? "" : String(count)
        ),
      })
    );
  }
  return deleteLines(next, new Set(deletions), false).otoSet;
};
