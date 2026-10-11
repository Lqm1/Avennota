import { describe, expect, it } from "vitest";

import { middlePlayRange, nearestPlayRange } from "../audio/play-ranges";
import { mixTimingClips } from "../audio/timing-player";
import {
  moveMarkerWithConstraints,
  cutoffInMode,
} from "../oto/marker-movement";
import { parseOto, isOtoLine, serializeOto } from "../oto/oto-set";
import type { OtoSet } from "../oto/oto-set";
import {
  changeAliases,
  changeCells,
  copyCells,
  editCell,
  pasteCells,
} from "./bulk-edit";
import { CELL_COLUMNS } from "./cell-selection";
import { editorCommand, tableCommand } from "./keyboard-commands";
import { DEFAULT_SETTINGS } from "./settings";

const params = {
  offset: 100,
  consonant: 350,
  cutoff: 100,
  preutter: 100,
  overlap: 50,
};
const fixture = (
  text = "a.wav=a,100,350,-800,100,50\nb.wav=b,100,350,-800,100,50\n"
) => parseOto(new TextEncoder().encode(text), "utf-8");
const row = (source: OtoSet, index = 0) => {
  const line = source.lines[index];
  if (line === undefined || !isOtoLine(line)) {
    throw new Error("Missing row");
  }
  return line;
};
const key = (
  value: string,
  modifiers: Partial<{
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }> = {}
) => ({
  key: value,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
});

describe("編集画面の入力操作", () => {
  it("CtrlShiftLは左ブランク単独移動を選択し、外部合成のキーを転用しない", () => {
    expect(
      editorCommand(key("L", { ctrlKey: true, shiftKey: true }), false)
    ).toBe("offsetPositions");
    expect(editorCommand(key("F10"), false)).toBeNull();
  });

  it.each([
    ["2", "next"],
    ["8", "previous"],
    ["4", "left"],
    ["6", "right"],
    ["5", "play"],
    [" ", "play"],
    ["F11", "zoomOut"],
    ["F12", "zoomIn"],
    ["P", "toggleP"],
    ["L", "toggleS"],
  ])("波形の%s", (input, command) => {
    expect(editorCommand(key(input), false)).toBe(command);
  });

  it("表のSpaceは入力、ShiftSpaceは再生、CtrlSpaceは範囲再生", () => {
    expect(editorCommand(key(" "), true)).toBeNull();
    expect(tableCommand(key(" "), false)).toStrictEqual({
      kind: "type",
      text: " ",
    });
    expect(editorCommand(key(" ", { shiftKey: true }), true)).toBe("play");
    expect(editorCommand(key(" ", { ctrlKey: true }), true)).toBe("range");
    expect(
      editorCommand(key(" ", { ctrlKey: true, shiftKey: true }), false)
    ).toBe("visible");
  });

  it("一覧のEnterとTab、CtrlJ/K/U、Alt矢印", () => {
    expect(tableCommand(key("Enter"), true)).toStrictEqual({
      kind: "move",
      row: 1,
      column: 0,
    });
    expect(tableCommand(key("Tab", { shiftKey: true }), true)).toStrictEqual({
      kind: "move",
      row: 0,
      column: -1,
    });
    expect(tableCommand(key("u", { ctrlKey: true }), true)).toStrictEqual({
      kind: "move",
      row: -1,
      column: 0,
    });
    expect(
      tableCommand(key("ArrowRight", { altKey: true }), true)
    ).toStrictEqual({
      kind: "move",
      row: 0,
      column: 1,
    });
  });

  it("入力中も表のコピーを使い、CtrlAltDを行削除に誤解しない", () => {
    expect(tableCommand(key("c", { ctrlKey: true }), true)).toStrictEqual({
      kind: "clipboard",
      action: "copy",
    });
    expect(
      editorCommand(key("d", { ctrlKey: true, altKey: true }), true)
    ).toBeNull();
    expect(
      editorCommand(key("d", { ctrlKey: true, shiftKey: true }), true)
    ).toBeNull();
  });

  it("近傍再生は数値順の前後、マーカー上では同値を除外", () => {
    expect(nearestPlayRange(params, 1000, 175)).toStrictEqual([150, 200]);
    expect(nearestPlayRange(params, 1000, 200)).toStrictEqual([150, 450]);
    expect(nearestPlayRange(params, 1000, 950)).toStrictEqual([900, 1000]);
    expect(middlePlayRange("offset", params, 1000)).toStrictEqual([0, 100]);
    expect(middlePlayRange("consonant", params, 1000)).toStrictEqual([
      100, 450,
    ]);
  });

  it.each([100, -800])(
    "先行発声連動で末尾を越えない（cutoff=%s）",
    (cutoff) => {
      expect(
        moveMarkerWithConstraints(
          { ...params, cutoff },
          "preutter",
          400,
          1000,
          {
            ...DEFAULT_SETTINGS,
            preutterMode: "relative",
          }
        )
      ).toStrictEqual({
        ...params,
        cutoff: cutoff < 0 ? -800 : 0,
        offset: 200,
      });
    }
  );

  it("左右ブランク優先と負のオーバーラップを切り替える", () => {
    expect(
      moveMarkerWithConstraints(params, "offset", 300, 1000, DEFAULT_SETTINGS)
        .preutter
    ).toBe(0);
    expect(
      moveMarkerWithConstraints(params, "offset", 300, 1000, {
        ...DEFAULT_SETTINGS,
        blankBroom: false,
      }).offset
    ).toBe(150);
    expect(
      moveMarkerWithConstraints(params, "overlap", 20, 1000, DEFAULT_SETTINGS)
        .overlap
    ).toBe(0);
    expect(
      moveMarkerWithConstraints(params, "overlap", 20, 1000, {
        ...DEFAULT_SETTINGS,
        negativeOverlap: true,
      }).overlap
    ).toBe(-80);
  });

  it("右ブランク表現を終端を保って変換する", () => {
    expect(cutoffInMode(params, 1000, "negative")).toBe(-800);
    expect(cutoffInMode({ ...params, cutoff: -800 }, 1000, "positive")).toBe(
      100
    );
  });
});

describe("セル編集", () => {
  it("%mと%sは連続音の先行部と音名、接尾辞を分離する", () => {
    const source = fixture("a.wav=a あ強,100,350,-800,100,50\n");
    const next = changeAliases(source, new Set([row(source).id]), {
      rule: "%m|%s|%f",
      deletePrefix: 0,
      deleteSuffix: 0,
      maxDuplicates: 0,
    });
    expect(row(next).parsed.oto.alias).toBe("a あ|強|a");
  });

  it("重複上限の削除は後ろから行い、同じWAVの最初の行を残す", () => {
    const source = fixture(
      "b.wav=a,1,2,3,4,5\na.wav=a,10,2,3,4,5\na.wav=a,20,2,3,4,5\n"
    );
    const next = changeAliases(
      source,
      new Set(source.lines.map((line) => line.id)),
      { rule: "%a%r", deletePrefix: 0, deleteSuffix: 0, maxDuplicates: 1 }
    );
    expect(
      next.lines.filter(isOtoLine).map((line) => line.parsed.oto.offset)
    ).toStrictEqual([1, 10]);
  });

  it("空のoffset入力で他欄を変えず、符号だけの入力を保持する", () => {
    const source = fixture();
    const cell = { lineId: row(source).id, column: "offset" as const };
    expect(row(editCell(source, cell, "", true)).parsed.oto.preutter).toBe(100);
    expect(
      row(editCell(source, cell, "-", true)).parsed.oto.paramTexts[0]
    ).toBe("-");
    expect(row(editCell(source, cell, " 20", true)).parsed.oto.offset).toBe(
      100
    );
  });

  it("直接入力のoffsetは絶対位置維持、貼り付けは相対値維持", () => {
    const source = fixture();
    const cell = { lineId: row(source).id, column: "offset" as const };
    expect(row(editCell(source, cell, "120", true)).parsed.oto).toMatchObject({
      offset: 120,
      consonant: 330,
      cutoff: -780,
      preutter: 80,
      overlap: 30,
    });
    expect(row(pasteCells(source, [cell], "120")).parsed.oto).toMatchObject({
      offset: 120,
      consonant: 350,
      cutoff: -800,
      preutter: 100,
      overlap: 50,
    });
  });

  it("選択した矩形だけに繰り返し貼り付ける", () => {
    const source = fixture();
    const cells = source.lines.filter(isOtoLine).flatMap((line) => [
      { lineId: line.id, column: "preutter" as const },
      { lineId: line.id, column: "overlap" as const },
    ]);
    const next = pasteCells(source, cells, "12,34\n");
    expect(row(next).parsed.oto).toMatchObject({
      preutter: 34,
      overlap: 12,
      offset: 100,
    });
    expect(row(next, 1).parsed.oto).toMatchObject({
      preutter: 34,
      overlap: 12,
    });
    expect(
      copyCells(source, [
        { lineId: row(source).id, column: "wav" },
        { lineId: row(source).id, column: "offset" },
      ])
    ).toBe("a,100\n");
    expect(CELL_COLUMNS).toStrictEqual([
      "wav",
      "offset",
      "overlap",
      "preutter",
      "consonant",
      "cutoff",
      "alias",
      "comment",
    ]);
  });

  it("コメント列は行のコメントを編集・コピーし、iniの行を変えない", () => {
    const source = fixture();
    const cell = { lineId: row(source).id, column: "comment" as const };
    const edited = editCell(source, cell, "確認\n済み", false);
    expect(row(edited).comment).toBe("確認 済み");
    expect(row(edited).text).toBe(row(source).text);
    expect(editCell(edited, cell, "確認 済み", false)).toBe(edited);
    expect(
      copyCells(edited, [{ lineId: row(edited).id, column: "alias" }, cell])
    ).toBe("a,確認 済み\n");
    expect(row(pasteCells(source, [cell], "メモ\n")).comment).toBe("メモ");
  });

  it("空欄は空欄のまま保存し、小数第3位で打ち切る", () => {
    const source = fixture();
    const cell = { lineId: row(source).id, column: "overlap" as const };
    const empty = changeCells(source, [cell], {
      mode: "set",
      value: "",
      condition: "all",
      threshold: 0,
    });
    const serialized = serializeOto(empty);
    if (!serialized.ok) {
      throw new Error("Serialization failed");
    }
    expect(new TextDecoder().decode(serialized.bytes)).toContain(
      "a.wav=a,100,350,-800,100,\n"
    );
    expect(
      row(editCell(source, cell, "12.3459", false)).parsed.oto.overlap
    ).toBe(12.345);
    expect(
      row(editCell(source, cell, "1000001", false)).parsed.oto.overlap
    ).toBe(50);
  });

  it("条件付き加算とエイリアス重複番号、最後のWAV行保持", () => {
    const source = fixture(
      "a.wav=a,100,350,-800,100,50\na.wav=a,100,350,-800,100,50\nb.wav=a,100,350,-800,100,50\n"
    );
    const cells = source.lines
      .filter(isOtoLine)
      .map((line) => ({ lineId: line.id, column: "offset" as const }));
    expect(
      row(
        changeCells(source, cells, {
          mode: "add",
          value: "20",
          condition: "atLeast",
          threshold: 101,
        })
      ).parsed.oto.offset
    ).toBe(100);
    const next = changeAliases(
      source,
      new Set(cells.map((cell) => cell.lineId)),
      { rule: "%a%r", deletePrefix: 0, deleteSuffix: 0, maxDuplicates: 1 }
    );
    expect(
      next.lines.filter(isOtoLine).map((line) => line.parsed.oto.wav)
    ).toStrictEqual(["a.wav", "b.wav"]);
    expect(
      next.lines.filter(isOtoLine).map((line) => line.parsed.oto.alias)
    ).toStrictEqual(["a", "a"]);
  });
});

describe("F8発声タイミング", () => {
  it("先行発声をプリカウント後の拍へ配置し、選択行を連結する", () => {
    const samples = new Float32Array(1000);
    samples[200] = 1;
    const clip = { samples, offset: 100, preutter: 200, end: 500 };
    const output = mixTimingClips([clip, clip], new Float32Array([1]), 1000, {
      tempo: 120,
      preCount: 3,
      mix: 0.5,
    });
    expect(output).toHaveLength(4000);
    expect(output[0]).toBe(0.5);
    expect(output[1500]).toBe(1);
    expect(output[2000]).toBe(0.5);
    expect(output[3500]).toBe(1);
  });

  it("一拍を越える先行部分を切り、終了位置までを含める", () => {
    const samples = new Float32Array(2000);
    samples[900] = 1;
    samples[1200] = 0.8;
    const output = mixTimingClips(
      [{ samples, offset: 0, preutter: 900, end: 1200 }],
      new Float32Array([0]),
      1000,
      { tempo: 120, preCount: 1, mix: 1 }
    );
    expect(output[500]).toBe(1);
    expect(output[800]).toBeCloseTo(0.8);
  });
});
