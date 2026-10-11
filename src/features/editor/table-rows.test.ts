import { describe, expect, it } from "vitest";

import { parseOto, replaceLine, setLineText } from "../oto/oto-set";
import { buildRows } from "./rows";
import { buildTableRows } from "./table-rows";

const fixture = () => {
  const set = parseOto(
    new TextEncoder().encode(
      Array.from(
        { length: 2000 },
        (_, i) => `a.wav=alias_${i},0,100,0,50,20`
      ).join("\n")
    )
  );
  const wavs = new Map([["a.wav", "a.wav"]]);
  return { set, wavs, rows: buildRows(set, wavs, new Map()) };
};

describe("table collection updates", () => {
  it("changes only the old and new rows when moving the selected cell in a large table", () => {
    const { rows } = fixture();
    const first = {
      lineId: rows[0]?.id ?? "missing",
      column: "preutter",
    } as const;
    const next = { lineId: rows[1]?.id ?? "missing", column: "alias" } as const;
    const before = buildTableRows(rows, [first], first, null);
    const after = buildTableRows(rows, [next], next, null);
    expect(after.filter((row, index) => row !== before[index])).toHaveLength(2);
    expect(after[0]?.selectedColumns).toStrictEqual([]);
    expect(after[1]?.selectedColumns).toStrictEqual(["alias"]);
    expect(after[1]?.activeColumn).toBe("alias");
    expect(buildTableRows(rows, [next], next, null)).toStrictEqual(after);
  });

  it("refreshes inline editing text and range selection without rebuilding unrelated rows", () => {
    const { rows } = fixture();
    const cell = { lineId: rows[0]?.id ?? "missing", column: "alias" } as const;
    const before = buildTableRows(rows, [cell], cell, { cell, text: "old" });
    const after = buildTableRows(rows, [cell], cell, { cell, text: "new" });
    expect(after[0]?.editing?.text).toBe("new");
    expect(after.filter((row, index) => row !== before[index])).toHaveLength(1);
    const cells = [cell, { ...cell, column: "cutoff" } as const];
    const range = buildTableRows(rows, cells, cell, null);
    expect(range[0]?.selectedColumns).toStrictEqual(["cutoff", "alias"]);
    expect(range[0]?.editing).toBeNull();
    expect(range[1]).toBe(after[1]);
  });

  it("refreshes edited values and changed warnings", () => {
    const { set, rows, wavs } = fixture();
    const before = buildTableRows(rows, [], null, null);
    const edited = replaceLine(set, rows[0]?.id ?? "missing", (line) =>
      setLineText(line, "a.wav=alias_0,0,100,0,70,20")
    );
    const after = buildTableRows(
      buildRows(edited, wavs, new Map()),
      [],
      null,
      null
    );
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    const missing = buildTableRows(
      buildRows(edited, new Map(), new Map()),
      [],
      null,
      null
    );
    expect(missing[1]).not.toBe(after[1]);
    expect(
      missing[1]?.statuses.some((status) => status.text === "WAVがありません")
    ).toBeTruthy();
  });
});
