import { continuesSyllable } from "./japanese";
import type { CvTiming } from "./oto-generation";

export interface SyllableTiming extends CvTiming {
  syllable: string;
  consonant: string;
  consonantFromPreutter: number;
}

export class SyllableTable {
  readonly entries: readonly SyllableTiming[];

  constructor(entries: readonly SyllableTiming[]) {
    this.entries = entries;
  }

  static parse(text: string): SyllableTable {
    const entries: SyllableTiming[] = [];
    for (const [index, row] of text.split(/\r\n|\r|\n/u).entries()) {
      if (row.trim() === "") {
        continue;
      }
      const fields = row.split(",");
      const syllable = fields[0]?.trim();
      const consonantFromPreutter = Number(fields[3]);
      const preutter = Number(fields[4]);
      const overlap = Number(fields[5]);
      if (
        syllable === undefined ||
        syllable === "" ||
        fields.length < 6 ||
        fields[4]?.trim() === "" ||
        fields[5]?.trim() === "" ||
        !Number.isFinite(consonantFromPreutter) ||
        !Number.isFinite(preutter) ||
        !Number.isFinite(overlap) ||
        preutter < 0 ||
        overlap > preutter
      ) {
        throw new Error(
          `table.csvの${index + 1}行目を解釈できません。1列目の仮名と4〜6列目の時間を確認してください。`
        );
      }
      entries.push({
        syllable,
        consonant: fields[1]?.trim() ?? "",
        consonantFromPreutter,
        preutter,
        overlap,
      });
    }
    return new SyllableTable(entries);
  }

  get size(): number {
    return this.entries.length;
  }

  longestPrefixOf(text: string): SyllableTiming | null {
    let found: SyllableTiming | null = null;
    for (const entry of this.entries) {
      if (
        text.startsWith(entry.syllable) &&
        !continuesSyllable(text, entry.syllable.length) &&
        entry.syllable.length > (found?.syllable.length ?? 0)
      ) {
        found = entry;
      }
    }
    return found;
  }

  cvTimings(): Map<string, CvTiming> {
    return new Map(
      this.entries.map(({ syllable, preutter, overlap }) => [
        syllable.normalize("NFKC"),
        { preutter, overlap },
      ])
    );
  }
}
