import { decodeBytes, encodeText, guessEncoding } from "../oto/encoding";
import type { OtoSet } from "../oto/oto-set";

export const commentFileName = (ini: string): string =>
  `${ini.slice(0, -4)}-comment.txt`;
export const readComments = (
  set: OtoSet,
  bytes: Uint8Array<ArrayBuffer>
): OtoSet => {
  const comments = decodeBytes(bytes, guessEncoding(bytes).encoding).split(
    /\r\n|\n|\r/u
  );
  let index = 0;
  return {
    ...set,
    lines: set.lines.map((line) => {
      if (line.parsed.kind !== "oto") {
        return line;
      }
      const comment = comments[index] ?? "";
      index += 1;
      return { ...line, comment };
    }),
  };
};
export const writeComments = (set: OtoSet): Uint8Array<ArrayBuffer> =>
  new Uint8Array(
    encodeText(
      set.lines
        .filter((line) => line.parsed.kind === "oto")
        .map((line) => line.comment ?? "")
        .join(set.eol) + set.eol,
      set.encoding
    )
  );
