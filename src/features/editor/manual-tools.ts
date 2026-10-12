import type { OtoSet } from "../oto/oto-set";
import {
  copyLine,
  effectiveAlias,
  fileStem,
  formatOto,
  insertLines,
  isOtoLine,
  parseOto,
} from "../oto/oto-set";

const kanaSortKey = (alias: string) => {
  const [prefix = "", syllable] = alias.split(" ");
  const sound = syllable ?? prefix;
  const match = /^(?<sound>[^\d]+)(?<sequence>.*)$/u.exec(sound);
  return `${match?.groups?.sound ?? sound}${syllable === undefined ? "" : prefix}${match?.groups?.sequence ?? ""}`;
};
export const sortRows = (set: OtoSet, mode: "kana" | "wav"): OtoSet => {
  const rows = set.lines.filter(isOtoLine).toSorted((a, b) => {
    const left =
      mode === "wav"
        ? fileStem(a.parsed.oto.wav)
        : kanaSortKey(effectiveAlias(a.parsed.oto));
    const right =
      mode === "wav"
        ? fileStem(b.parsed.oto.wav)
        : kanaSortKey(effectiveAlias(b.parsed.oto));
    return left < right ? -1 : Number(left > right);
  });
  let index = 0;
  const lines = set.lines.map((line) => {
    if (line.parsed.kind !== "oto") {
      return line;
    }
    const row = rows[index] ?? line;
    index += 1;
    return row;
  });
  return lines.every((line, i) => line === set.lines[i])
    ? set
    : { ...set, lines };
};
export const mergeRows = (
  set: OtoSet,
  bytes: Uint8Array<ArrayBuffer>
): OtoSet => {
  const imported = parseOto(bytes);
  return insertLines(set, set.lines.length, imported.lines);
};
export const complementAliases = (
  set: OtoSet,
  mode: "continuous" | "kana",
  known: ReadonlySet<string> = new Set()
): OtoSet => {
  const aliases = new Set([
    ...known,
    ...set.lines.flatMap((line) =>
      line.parsed.kind === "oto" ? [effectiveAlias(line.parsed.oto)] : []
    ),
  ]);
  let { lines } = set;
  const replacements =
    mode === "kana"
      ? ([
          ["お", "を"],
          ["じ", "ぢ"],
          ["ず", "づ"],
        ] as const)
      : ([["", ""]] as const);
  for (const [source, target] of replacements) {
    const pass = [...lines];
    for (let i = pass.length - 1; i >= 0; i -= 1) {
      const line = pass[i];
      if (line?.parsed.kind !== "oto") {
        continue;
      }
      const { oto } = line.parsed;
      const stem = fileStem(oto.wav);
      const candidates: string[] = [];
      if (mode === "continuous" && !stem.startsWith("_")) {
        candidates.push(
          ...["a", "i", "u", "e", "o", "n", "-"].map(
            (prev) => `${prev} ${stem}`
          )
        );
      } else if (mode === "kana") {
        if (oto.alias.includes(source)) {
          candidates.push(oto.alias.replace(source, target));
        }
        if (stem.startsWith(source)) {
          candidates.push(stem.replace(source, target));
        }
      }
      const added = candidates.filter((alias) => {
        if (aliases.has(alias)) {
          return false;
        }
        aliases.add(alias);
        return true;
      });
      pass.splice(
        i + 1,
        0,
        ...added.map((alias) => copyLine(line, formatOto({ ...oto, alias })))
      );
    }
    lines = pass;
  }
  return lines.length === set.lines.length ? set : { ...set, lines };
};
export interface UstNote {
  alias: string;
  number: string;
}
const SECTION = /^\[#(?<section>.+)\]$/u;
export const parseUstNotes = (text: string): UstNote[] => {
  let section = "";
  const notes: UstNote[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    const match = SECTION.exec(line);
    if (match !== null) {
      section = match.groups?.section ?? "";
    } else if (line.startsWith("Lyric=") && /^\d+$/u.test(section)) {
      const alias = line.slice(6);
      if (alias !== "R") {
        notes.push({ alias, number: section });
      }
    }
  }
  return notes;
};
const ustMatches = (wav: string, alias: string, lyric: string): boolean => {
  if (fileStem(wav) === lyric || alias === lyric) {
    return true;
  }
  return (
    alias.startsWith(lyric) &&
    !/[ぁ-ゖァ-ヺー]/u.test(alias.charAt(lyric.length))
  );
};
export const ustTargets = (
  set: OtoSet,
  notes: UstNote[],
  limit = 0
): Map<string, string[]> => {
  const numbers = new Map<string, string[]>();
  for (const note of notes) {
    const list = numbers.get(note.alias) ?? [];
    list.push(note.number);
    numbers.set(note.alias, list);
  }
  const targets = new Map<string, string[]>();
  for (const [lyric, references] of numbers) {
    let count = 0;
    for (const line of set.lines) {
      if (
        line.parsed.kind === "oto" &&
        ustMatches(line.parsed.oto.wav, line.parsed.oto.alias, lyric)
      ) {
        if (limit > 0 && count >= limit) {
          break;
        }
        targets.set(line.id, [...(targets.get(line.id) ?? []), ...references]);
        count += 1;
      }
    }
  }
  return targets;
};
export const annotateUst = (
  set: OtoSet,
  notes: UstNote[],
  comment = "",
  limit = 0
): OtoSet => {
  const references = ustTargets(set, notes, limit);
  const lines = set.lines.map((line) => {
    const used = references.get(line.id);
    if (used === undefined) {
      return line;
    }
    const append = comment || `UST: ${used.join(", ")}`;
    return {
      ...line,
      comment:
        (line.comment ?? "") === "" ? append : `${line.comment} ${append}`,
    };
  });
  return { ...set, lines };
};
