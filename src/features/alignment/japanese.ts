export interface Mora {
  kana: string;
  phones: string[];
}

const moraPhones = new Map<string, string[]>();
const add = (kana: string, phones: string) => {
  moraPhones.set(kana, phones.split(" "));
};
for (const [kana, consonant] of [
  ["あいうえお", ""],
  ["かきくけこ", "k"],
  ["がぎぐげご", "g"],
  ["さしすせそ", "s"],
  ["ざじずぜぞ", "z"],
  ["たちつてと", "t"],
  ["だぢづでど", "d"],
  ["なにぬねの", "n"],
  ["はひふへほ", "h"],
  ["ばびぶべぼ", "b"],
  ["ぱぴぷぺぽ", "p"],
  ["まみむめも", "m"],
  ["らりるれろ", "r"],
] satisfies [string, string][]) {
  for (const [index, character] of kana.split("").entries()) {
    const vowel = "aiueo"[index];
    if (vowel !== undefined) {
      add(character, consonant ? `${consonant} ${vowel}` : vowel);
    }
  }
}
for (const [kana, phones] of [
  ["し", "sh i"],
  ["じ", "j i"],
  ["ち", "ch i"],
  ["つ", "ts u"],
  ["ぢ", "j i"],
  ["づ", "z u"],
  ["ふ", "f u"],
  ["や", "y a"],
  ["ゆ", "y u"],
  ["よ", "y o"],
  ["わ", "w a"],
  ["ゐ", "i"],
  ["ゑ", "e"],
  ["を", "o"],
  ["ん", "N"],
  ["っ", "cl"],
  ["ゔ", "v u"],
  ["ぁ", "a"],
  ["ぃ", "i"],
  ["ぅ", "u"],
  ["ぇ", "e"],
  ["ぉ", "o"],
] satisfies [string, string][]) {
  add(kana, phones);
}
for (const [base, consonant] of [
  ["き", "ky"],
  ["ぎ", "gy"],
  ["し", "sh"],
  ["じ", "j"],
  ["ち", "ch"],
  ["ぢ", "j"],
  ["に", "ny"],
  ["ひ", "hy"],
  ["び", "by"],
  ["ぴ", "py"],
  ["み", "my"],
  ["り", "ry"],
] satisfies [string, string][]) {
  for (const [small, vowel] of [
    ["ゃ", "a"],
    ["ゅ", "u"],
    ["ょ", "o"],
  ] satisfies [string, string][]) {
    add(`${base}${small}`, `${consonant} ${vowel}`);
  }
}
for (const [kana, consonant, vowel] of [
  ["いぇ", "y", "e"],
  ["うぃ", "w", "i"],
  ["うぇ", "w", "e"],
  ["うぉ", "w", "o"],
  ["しぇ", "sh", "e"],
  ["じぇ", "j", "e"],
  ["ちぇ", "ch", "e"],
  ["てぃ", "t", "i"],
  ["とぅ", "t", "u"],
  ["でぃ", "d", "i"],
  ["どぅ", "d", "u"],
  ["てゅ", "ty", "u"],
  ["てゃ", "ty", "a"],
  ["てょ", "ty", "o"],
  ["でゅ", "dy", "u"],
  ["でゃ", "dy", "a"],
  ["でょ", "dy", "o"],
  ["ふぁ", "f", "a"],
  ["ふぃ", "f", "i"],
  ["ふぇ", "f", "e"],
  ["ふぉ", "f", "o"],
  ["ふゅ", "fy", "u"],
  ["つぁ", "ts", "a"],
  ["つぃ", "ts", "i"],
  ["つぇ", "ts", "e"],
  ["つぉ", "ts", "o"],
  ["ゔぁ", "v", "a"],
  ["ゔぃ", "v", "i"],
  ["ゔぇ", "v", "e"],
  ["ゔぉ", "v", "o"],
  ["ゔゅ", "vy", "u"],
  ["きぇ", "ky", "e"],
  ["ぎぇ", "gy", "e"],
  ["にぇ", "ny", "e"],
  ["ひぇ", "hy", "e"],
  ["びぇ", "by", "e"],
  ["ぴぇ", "py", "e"],
  ["みぇ", "my", "e"],
  ["りぇ", "ry", "e"],
] satisfies [string, string, string][]) {
  add(kana, `${consonant} ${vowel}`);
}

const KATAKANA = /[ァ-ヶ]/gu;
const SEPARATORS = /^[\s_]+/u;
const TRAILING_SEPARATORS = /[\s_]+$/u;
const WAV_EXTENSION = /\.wav$/iu;

export const normalizeKana = (text: string): string =>
  text.normalize("NFKC").replace(KATAKANA, (character) => {
    const point = character.codePointAt(0);
    return point === undefined ? character : String.fromCodePoint(point - 0x60);
  });

/** 読めない文字を捨てず、発音列を利用者が訂正できるように止める。 */
export const parseMorae = (text: string): Mora[] => {
  let remaining = normalizeKana(text)
    .replace(SEPARATORS, "")
    .replace(TRAILING_SEPARATORS, "");
  const morae: Mora[] = [];
  while (remaining.length > 0) {
    const separator = SEPARATORS.exec(remaining)?.[0];
    if (separator !== undefined) {
      morae.push({ kana: "_", phones: ["pau"] });
      remaining = remaining.slice(separator.length);
      continue;
    }
    if (remaining.startsWith("ー")) {
      const vowel = morae.at(-1)?.phones.at(-1);
      if (vowel === undefined || !"aiueo".includes(vowel)) {
        throw new Error("長音の直前に母音がありません。");
      }
      const kana = "あいうえお"["aiueo".indexOf(vowel)];
      if (kana === undefined) {
        throw new Error("長音の母音を解釈できません。");
      }
      morae.push({ kana, phones: [vowel] });
      remaining = remaining.slice(1);
      continue;
    }
    const pair = remaining.slice(0, 2);
    const kana = moraPhones.has(pair) ? pair : remaining.slice(0, 1);
    const phones = moraPhones.get(kana);
    if (!phones) {
      throw new Error(
        `発音列の「${remaining}」を解釈できません。仮名または音素列を指定してください。`
      );
    }
    morae.push({ kana, phones: [...phones] });
    remaining = remaining.slice(kana.length);
  }
  if (morae.length === 0) {
    throw new Error("発音列が空です。");
  }
  return morae;
};

export const transcriptionFromFilename = (
  wav: string,
  suffix: string
): string => {
  const stem = wav.replace(WAV_EXTENSION, "");
  return suffix && stem.endsWith(suffix) ? stem.slice(0, -suffix.length) : stem;
};

/** 音素列から標準仮名を復元する。別名の仮名は画面で指定できる。 */
export const moraeFromPhones = (phones: string[]): Mora[] => {
  const morae: Mora[] = [];
  let at = 0;
  while (at < phones.length) {
    const phone = phones[at];
    if (phone === "pau") {
      morae.push({ kana: "_", phones: [phone] });
      at += 1;
      continue;
    }
    const position = at;
    const match = [...moraPhones].find(([, expected]) =>
      expected.every((value, index) => {
        const actual = phones[position + index];
        return (
          actual === value ||
          (value.length === 1 &&
            "aiueo".includes(value) &&
            actual?.toLowerCase() === value)
        );
      })
    );
    if (match === undefined) {
      throw new Error(
        `音素「${phone}」から仮名を復元できません。発音列を指定してください。`
      );
    }
    const [kana, expected] = match;
    morae.push({ kana, phones: phones.slice(at, at + expected.length) });
    at += expected.length;
  }
  if (morae.length === 0) {
    throw new Error("発音列が空です。");
  }
  return morae;
};
