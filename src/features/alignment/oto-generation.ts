import {
  createOtoLine,
  fileStem,
  setLineOto,
  withParams,
} from "../oto/oto-set";
import type { OtoParams, OtoSet } from "../oto/oto-set";
import type { AlignedRecording } from "./client";
import type { PhoneInterval } from "./types";

export type VoicebankFormat = "cv" | "vcv" | "cvvc";
export interface OtoSuggestion extends OtoParams {
  wav: string;
  alias: string;
  duration: number;
}
export interface CvTiming {
  preutter: number;
  overlap: number;
}

const truncate = (value: number) => Math.trunc(value * 1000) / 1000;
export const continuousTiming = (bpm: number): OtoParams => {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new Error("収録BPMは0より大きい数値を指定してください。");
  }
  const beat = 60_000 / bpm;
  const overlap = truncate(beat / 6);
  return {
    offset: 0,
    preutter: truncate(beat / 2),
    overlap,
    consonant: truncate((beat * 3) / 4),
    cutoff: truncate(-(beat + overlap)),
  };
};

export const readCvTimingTable = (text: string): Map<string, CvTiming> => {
  const table = new Map<string, CvTiming>();
  for (const [index, row] of text.split(/\r\n|\r|\n/u).entries()) {
    if (row.trim() === "") {
      continue;
    }
    const fields = row.split(",");
    const alias = fields[0]?.trim();
    const preutter = Number(fields[4]);
    const overlap = Number(fields[5]);
    if (
      alias === undefined ||
      alias === "" ||
      fields.length < 6 ||
      fields[4]?.trim() === "" ||
      fields[5]?.trim() === "" ||
      !Number.isFinite(preutter) ||
      !Number.isFinite(overlap) ||
      preutter < 0 ||
      overlap > preutter
    ) {
      throw new Error(
        `table.csvの${index + 1}行目を解釈できません。1列目の仮名と5・6列目の時間を確認してください。`
      );
    }
    table.set(alias.normalize("NFKC"), { preutter, overlap });
  }
  return table;
};

const vowelName = (name: string) => (name === "N" ? "n" : name.toLowerCase());
const VOWELS = new Set(["a", "i", "u", "e", "o", "A", "I", "U", "E", "O", "N"]);
const syllableParams = ({
  first,
  vowel,
  continuous,
  timing,
  cvTiming,
}: {
  first: PhoneInterval;
  vowel: PhoneInterval;
  continuous: boolean;
  timing: OtoParams;
  cvTiming: CvTiming | undefined;
}): OtoParams => {
  const requestedPreutter = continuous
    ? timing.preutter
    : (cvTiming?.preutter ?? (vowel.start - first.start) * 1000);
  const offset = Math.max(0, vowel.start * 1000 - requestedPreutter);
  const preutter = vowel.start * 1000 - offset;
  const end = Math.min(
    vowel.end * 1000,
    continuous ? offset - timing.cutoff : vowel.end * 1000
  );
  return {
    offset,
    preutter,
    overlap: Math.min(
      preutter,
      continuous ? timing.overlap : (cvTiming?.overlap ?? 0)
    ),
    consonant: Math.min(
      continuous ? timing.consonant : preutter + 100,
      end - offset - 1
    ),
    cutoff: -(end - offset),
  };
};
const cvvcTransition = ({
  recording,
  previous,
  first,
  vowel,
  kana,
  suffix,
  timing,
}: {
  recording: AlignedRecording;
  previous: PhoneInterval;
  first: PhoneInterval;
  vowel: PhoneInterval;
  kana: string;
  suffix: string;
  timing: OtoParams;
}): OtoSuggestion | undefined => {
  const vv = VOWELS.has(first.name) && first.name !== "N";
  if (vv) {
    return {
      wav: recording.wav,
      duration: recording.duration,
      alias: `${vowelName(previous.name)} ${kana}${suffix}`,
      ...syllableParams({
        first,
        vowel,
        continuous: true,
        timing,
        cvTiming: undefined,
      }),
    };
  }
  const start = Math.max(previous.start, first.start - 0.1) * 1000;
  const preutter = first.start * 1000 - start;
  const end = (first.name === "N" ? vowel.end : vowel.start) * 1000;
  if (end - start <= preutter + 1) {
    return undefined;
  }
  return {
    wav: recording.wav,
    duration: recording.duration,
    alias: `${vowelName(previous.name)} ${vowelName(first.name)}${suffix}`,
    offset: start,
    preutter,
    overlap: preutter / 3,
    consonant: Math.min(preutter + 10, end - start - 1),
    cutoff: -(end - start),
  };
};

export const generateOtoSuggestions = (
  recording: AlignedRecording,
  options: {
    format: VoicebankFormat;
    bpm: number;
    suffix: string;
    cvTimings: ReadonlyMap<string, CvTiming>;
  }
): OtoSuggestion[] => {
  const timing = continuousTiming(options.bpm);
  const suggestions: OtoSuggestion[] = [];
  let at = 0;
  let previous: { name: string; start: number; end: number } | undefined;
  const appendRelease = (limit: number) => {
    if (previous === undefined || options.format === "cv") {
      return;
    }
    const requestedPreutter = options.format === "vcv" ? timing.preutter : 100;
    const offset = Math.max(
      previous.start * 1000,
      previous.end * 1000 - requestedPreutter
    );
    const preutter = previous.end * 1000 - offset;
    const length = options.format === "vcv" ? -timing.cutoff : 200;
    const end = Math.min(limit * 1000, offset + length);
    if (end - offset <= preutter + 1) {
      return;
    }
    suggestions.push({
      wav: recording.wav,
      duration: recording.duration,
      alias: `${vowelName(previous.name)} R${options.suffix}`,
      offset,
      preutter,
      overlap: Math.min(preutter / 3, timing.overlap),
      consonant: Math.min(
        options.format === "vcv" ? timing.consonant : preutter + 20,
        end - offset - 1
      ),
      cutoff: -(end - offset),
    });
  };
  for (const mora of recording.morae) {
    const intervals = recording.intervals.slice(at, at + mora.phones.length);
    at += mora.phones.length;
    const [first] = intervals;
    const vowel = intervals.at(-1);
    if (
      !first ||
      !vowel ||
      intervals.some((phone, index) => phone.name !== mora.phones[index])
    ) {
      throw new Error(`「${recording.wav}」の推定結果と発音列が一致しません。`);
    }
    if (vowel.name === "pau") {
      appendRelease(vowel.end);
      previous = undefined;
      continue;
    }
    if (!VOWELS.has(vowel.name)) {
      continue;
    }
    const continuous = options.format === "vcv" && previous !== undefined;
    const kana = mora.kana.replaceAll("ゔ", "ヴ");
    const cvTiming =
      options.cvTimings.get(kana.normalize("NFKC")) ??
      options.cvTimings.get(mora.kana.normalize("NFKC"));
    const onset = options.format === "cv" ? recording.cvOnset : null;
    const params = syllableParams({
      first: onset ? { ...first, start: onset.speechStart } : first,
      vowel: onset ? { ...vowel, start: onset.voicingStart } : vowel,
      continuous,
      timing,
      cvTiming,
    });
    if (
      params.consonant < params.preutter ||
      -params.cutoff <= params.consonant
    ) {
      throw new Error(
        `「${recording.wav}」の「${mora.kana}」に伸縮できる母音区間がありません。発音列と推定境界を確認してください。`
      );
    }
    let prefix = "";
    if (options.format === "vcv") {
      prefix = `${previous === undefined ? "-" : vowelName(previous.name)} `;
    }
    suggestions.push({
      wav: recording.wav,
      duration: recording.duration,
      alias: `${prefix}${kana}${options.suffix}`,
      ...params,
    });
    if (options.format === "cvvc" && previous !== undefined) {
      const transition = cvvcTransition({
        recording,
        previous,
        first,
        vowel,
        kana,
        suffix: options.suffix,
        timing,
      });
      if (transition) {
        suggestions.push(transition);
      }
    }
    previous = vowel;
  }
  if (at !== recording.intervals.length) {
    throw new Error(`「${recording.wav}」の推定結果に余分な音素があります。`);
  }
  appendRelease(recording.duration);
  return suggestions;
};

export const generateSelectedOtoSuggestions = (
  recording: AlignedRecording,
  options: {
    formats: ReadonlySet<VoicebankFormat>;
    bpm: number;
    suffix: string;
    cvTimings: ReadonlyMap<string, CvTiming>;
  }
): OtoSuggestion[] => {
  const seen = new Set<string>();
  const formats: VoicebankFormat[] = ["cv", "vcv", "cvvc"];
  return formats
    .filter((format) => options.formats.has(format))
    .flatMap((format) => {
      const occurrences = new Map<string, number>();
      return generateOtoSuggestions(recording, { ...options, format }).filter(
        (suggestion) => {
          const occurrence = (occurrences.get(suggestion.alias) ?? 0) + 1;
          occurrences.set(suggestion.alias, occurrence);
          // 同じ出現を形式間で共有し、録音中の繰り返しは重複番号用に残す。
          const key = `${suggestion.alias}\0${occurrence}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        }
      );
    });
};

const suggestionQueue = (
  available: ReadonlyMap<string, OtoSuggestion[]>,
  wav: string,
  alias: string,
  mode: "generate" | "update",
  suffix: string
) => {
  const exact =
    available.get(`${wav}\0${alias}`) ??
    (mode === "update"
      ? available.get(`${wav}\0${alias.replaceAll("ゔ", "ヴ")}`)
      : undefined);
  if (
    exact !== undefined ||
    mode === "generate" ||
    (suffix !== "" && !alias.endsWith(suffix))
  ) {
    return exact;
  }
  const stem = suffix === "" ? alias : alias.slice(0, -suffix.length);
  const base = stem.replace(/\d+$/u, "");
  return (
    available.get(`${wav}\0${base}${suffix}`) ??
    available.get(`${wav}\0${base.replace(/ -$/u, " R")}${suffix}`)
  );
};

export const applyOtoSuggestions = (
  set: OtoSet,
  suggestions: OtoSuggestion[],
  mode: "generate" | "update",
  duplicateLimit: number,
  suffix = ""
): OtoSet => {
  const occurrence = new Map<string, number>();
  const named = suggestions.flatMap((suggestion) => {
    const count = (occurrence.get(suggestion.alias) ?? 0) + 1;
    occurrence.set(suggestion.alias, count);
    if (mode === "generate" && duplicateLimit > 0 && count > duplicateLimit) {
      return [];
    }
    return [
      {
        ...suggestion,
        alias:
          mode === "update" || count === 1
            ? suggestion.alias
            : `${suffix === "" ? suggestion.alias : suggestion.alias.slice(0, -suffix.length)}${count}${suffix}`,
      },
    ];
  });
  const affectedWavs = new Set(
    suggestions.map((suggestion) => suggestion.wav.toLocaleLowerCase("ja"))
  );
  const available = new Map<string, OtoSuggestion[]>();
  for (const suggestion of named) {
    const key = `${suggestion.wav.toLocaleLowerCase("ja")}\0${suggestion.alias}`;
    const queue = available.get(key) ?? [];
    queue.push(suggestion);
    available.set(key, queue);
  }
  let changed = false;
  const lines = set.lines.flatMap((line) => {
    if (line.parsed.kind !== "oto") {
      return [line];
    }
    const { oto } = line.parsed;
    const wav = oto.wav.toLocaleLowerCase("ja");
    const alias = oto.alias || fileStem(oto.wav);
    const queue = suggestionQueue(available, wav, alias, mode, suffix);
    const suggestion = queue?.shift();
    if (suggestion) {
      const next = setLineOto(
        line,
        withParams(oto, {
          ...suggestion,
          cutoff:
            mode === "update" && oto.cutoff >= 0
              ? suggestion.duration * 1000 -
                suggestion.offset +
                suggestion.cutoff
              : suggestion.cutoff,
        })
      );
      changed ||= next !== line;
      return [next];
    }
    if (mode === "generate" && affectedWavs.has(wav)) {
      changed = true;
      return [];
    }
    return [line];
  });
  if (mode === "generate") {
    for (const remaining of available.values()) {
      for (const suggestion of remaining) {
        lines.push(createOtoLine(suggestion.wav, suggestion.alias, suggestion));
        changed = true;
      }
    }
  }
  return changed ? { ...set, lines } : set;
};
