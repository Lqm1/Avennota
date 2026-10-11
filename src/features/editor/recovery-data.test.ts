import { describe, expect, it } from "vitest";

import { encodeText } from "../oto/encoding";
import {
  parseOto,
  replaceLine,
  serializeOto,
  setLineText,
} from "../oto/oto-set";
import {
  deserializeOtoSet,
  recoveryDataSchema,
  storedOtoSetSchema,
  serializeOtoSetForRecovery,
} from "./recovery-data";

describe("復元データ", () => {
  it("保存した復元データを受け入れ、不正な欄や行を拒否する", () => {
    const otoSet = serializeOtoSetForRecovery(
      parseOto(encodeText("あ.wav=あ,1,2,3,4,5", "shift_jis"))
    );
    const data = { baselineHash: null, otoName: "oto.ini", otoSet };
    expect(recoveryDataSchema.safeParse(data).success).toBeTruthy();
    const invalid: unknown[] = [
      null,
      { ...data, baselineHash: 123 },
      { ...data, otoSet: { ...otoSet, encoding: "unknown" } },
      { ...data, otoSet: { ...otoSet, eol: "" } },
      { ...data, otoSet: { ...otoSet, lines: [null] } },
      {
        ...data,
        otoSet: {
          ...otoSet,
          lines: [
            { text: "test", source: { text: "test", raw: 123, eol: "" } },
          ],
        },
      },
    ];
    for (const value of invalid) {
      expect(recoveryDataSchema.safeParse(value).success).toBeFalsy();
    }
  });

  it("JSONを経由しても未編集行のバイト列と編集内容を保つ", () => {
    const bytes = encodeText(
      "あ.wav=あ,1,2,3,4,5\r\nい.wav=い,1,2,3,4,5",
      "shift_jis"
    );
    const otoSet = parseOto(bytes);
    const edited = replaceLine(otoSet, otoSet.lines[1]?.id ?? "", (line) =>
      setLineText(line, "い.wav=い2,1,2,3,4,5")
    );
    // ネイティブ版はJSONファイルに保存するため、文字列を経由させる。
    const stored = JSON.stringify(serializeOtoSetForRecovery(edited));
    const parsed: unknown = JSON.parse(stored);
    const restored = deserializeOtoSet(storedOtoSetSchema.parse(parsed));
    const before = serializeOto(edited);
    const after = serializeOto(restored);
    expect(after.ok && before.ok && after.bytes).toStrictEqual(
      before.ok && before.bytes
    );
    expect(restored.lines[0]?.source?.raw).toStrictEqual(
      otoSet.lines[0]?.source?.raw
    );
  });

  it("破損したBase64と元データの欠けた行を受け入れない", () => {
    const stored = serializeOtoSetForRecovery(
      parseOto(encodeText("a.wav=a,1,2,3,4,5", "utf-8"))
    );
    expect(
      storedOtoSetSchema.safeParse({ ...stored, bom: "invalid!" }).success
    ).toBeFalsy();
    expect(
      storedOtoSetSchema.safeParse({
        ...stored,
        lines: [{ text: "a", source: { text: "a", raw: null, eol: "" } }],
      }).success
    ).toBeFalsy();
  });
});
