/* eslint-disable no-await-in-loop -- Process one WAV at a time to bound memory and preserve transaction order. */
import type { FileChange } from "../../platform/files/transaction";
import {
  applyFileChanges,
  readIfExists,
} from "../../platform/files/transaction";
import { invalidateWavBlob } from "../audio/wav-cache";
import {
  decodePcmWave,
  encodePcmWave,
  processWave,
  trimOto,
  adjustTrimBlanks,
} from "../audio/wav-processing";
import { waveControls } from "../audio/wave-controls";
import { cutoffEnd } from "../oto/geometry";
import type { OtoSet } from "../oto/oto-set";
import { serializeOto, setLineOto, fileStem } from "../oto/oto-set";
import { commentFileName, writeComments } from "./comments";
import { createHistory } from "./history";
import { settingsStore } from "./settings";
import {
  ask,
  editorStore,
  errorText,
  notify,
  wavIndex,
  withBusy,
} from "./store";

/** WAVとiniを一緒に変更し、音声に対応しなくなる過去の編集履歴を破棄する。元データは.bakへ保存する。 */
const commitFiles = async (
  next: OtoSet,
  files: FileChange[]
): Promise<void> => {
  const { workspace } = editorStore.state;
  if (workspace.kind === "closed") {
    return;
  }
  const { session } = workspace;
  const serialized = serializeOto(next);
  if (!serialized.ok) {
    throw new Error("保存できない文字を先に修正してください。");
  }
  const storage = session.storageFolder ?? session.folder;
  const commentBytes = writeComments(next);
  const commentsName = commentFileName(session.otoName);
  const currentComments = await readIfExists(storage, commentsName);
  const hasComments =
    currentComments !== null ||
    next.lines.some((line) => (line.comment ?? "") !== "");
  if (workspace !== editorStore.state.workspace) {
    throw new Error("編集中の内容が変わりました。再度操作してください。");
  }
  await applyFileChanges(session.folder, [
    ...files,
    {
      folder: storage,
      name: session.otoName,
      before: session.baseline,
      after: serialized.bytes,
    },
    ...(hasComments
      ? [
          {
            folder: storage,
            name: commentsName,
            before: session.commentBaseline ?? null,
            after: commentBytes,
          },
        ]
      : []),
  ]);
  const names = await session.folder.listFiles();
  for (const name of session.wavs.values()) {
    invalidateWavBlob(session.folder, name);
  }
  editorStore.setState((state) => ({
    ...state,
    workspace: {
      kind: "open",
      session: {
        ...session,
        baseline: serialized.bytes,
        commentBaseline: hasComments ? commentBytes : null,
        savedOtoSet: next,
        wavs: wavIndex(names),
      },
      history: createHistory({
        otoSet: next,
        selectedId: workspace.history.present.selectedId,
      }),
    },
  }));
  waveControls()?.reload();
};
export const processWavs = async (
  names: string[],
  options: {
    dc: boolean;
    mono: boolean;
    headMs: number;
    tailMs: number;
    adjustBlanks?: boolean;
  }
): Promise<void> => {
  const { workspace, busy } = editorStore.state;
  if (workspace.kind === "closed" || busy !== "") {
    return;
  }
  if (
    (await ask({
      title: "WAVを加工して保存",
      message: `${names.length}件のファイルを加工し、原音設定と一緒に上書き保存します。元のファイルは.bakに退避されます。未保存の編集も保存され、編集履歴（元に戻す操作）はリセットされます。`,
      actions: [
        { id: "run", label: "加工して保存", tone: "danger" },
        { id: "cancel", label: "キャンセル" },
      ],
    })) !== "run"
  ) {
    return;
  }
  await withBusy("WAVを加工しています", async () => {
    try {
      let { lines } = workspace.history.present.otoSet;
      const changes: FileChange[] = [];
      for (const name of names) {
        const before = await workspace.session.folder.read(name);
        const wave = decodePcmWave(before);
        const result = processWave(wave, options);
        const length = wave.channels[0]?.length ?? 0;
        const duration = (length / wave.rate) * 1000;
        const head =
          (Math.round((options.headMs * wave.rate) / 1000) / wave.rate) * 1000;
        const tail =
          (Math.round((options.tailMs * wave.rate) / 1000) / wave.rate) * 1000;
        lines = lines.map((line) => {
          if (
            line.parsed.kind !== "oto" ||
            line.parsed.oto.wav.toLowerCase() !== name.toLowerCase() ||
            options.adjustBlanks === false
          ) {
            return line;
          }
          const corrected =
            options.adjustBlanks === true
              ? adjustTrimBlanks(line.parsed.oto, head, tail)
              : trimOto(line.parsed.oto, duration, head, tail);
          return setLineOto(line, corrected);
        });
        changes.push({ name, before, after: encodePcmWave(result) });
      }
      if (editorStore.state.workspace !== workspace) {
        throw new Error("編集中の内容が変わりました。加工は適用していません。");
      }
      await commitFiles(
        { ...workspace.history.present.otoSet, lines },
        changes
      );
      notify("info", `${names.length}ファイルを加工しました。`);
    } catch (error) {
      notify("error", `加工できません: ${errorText(error)}`);
    }
  });
};
export const renameWavs = async (related: boolean): Promise<void> => {
  const { workspace, busy } = editorStore.state;
  if (workspace.kind === "closed" || busy !== "") {
    return;
  }
  if (
    (await ask({
      title: "ファイル名に_を付加",
      message:
        "WAVファイル名と原音設定を変更して上書き保存します。元のファイルは.bakに退避され、編集履歴（元に戻す操作）はリセットされます。",
      actions: [
        { id: "run", label: "変更して保存", tone: "danger" },
        { id: "cancel", label: "キャンセル" },
      ],
    })) !== "run"
  ) {
    return;
  }
  await withBusy("ファイル名を変更しています", async () => {
    try {
      const names = await workspace.session.folder.listFiles();
      const map = new Map(
        [...workspace.session.wavs.values()]
          .filter((name) => !name.startsWith("_"))
          .map((name) => [name, `_${name}`])
      );
      const changes: FileChange[] = [];
      const used = new Set(names.map((name) => name.toLowerCase()));
      const files = names.filter(
        (name) =>
          map.has(name) ||
          (related &&
            [...map.keys()].some(
              (wav) =>
                name.startsWith(`${fileStem(wav)}.`) ||
                name.startsWith(`${fileStem(wav)}_wav.`)
            ))
      );
      for (const name of files) {
        const target = `_${name}`;
        if (used.has(target.toLowerCase())) {
          throw new Error(`${target}が既に存在します。`);
        }
        const before = await workspace.session.folder.read(name);
        changes.push(
          { name: target, before: null, after: before },
          { name, before, after: null }
        );
      }
      const mapped = new Map(
        [...map].map(([name, target]) => [name.toLowerCase(), target])
      );
      const next = {
        ...workspace.history.present.otoSet,
        lines: workspace.history.present.otoSet.lines.map((line) => {
          if (line.parsed.kind !== "oto") {
            return line;
          }
          const name = mapped.get(line.parsed.oto.wav.toLowerCase());
          return name === undefined
            ? line
            : setLineOto(line, { ...line.parsed.oto, wav: name });
        }),
      };
      if (workspace !== editorStore.state.workspace) {
        throw new Error("編集中の内容が変わりました。変更は適用していません。");
      }
      await commitFiles(next, changes);
      notify("info", `${map.size}件のWAV名を変更しました。`);
    } catch (error) {
      notify("error", `ファイル名を変更できません: ${errorText(error)}`);
    }
  });
};
export const trimSelectedWav = async (): Promise<void> => {
  if (!settingsStore.state.advanced.allowTrim) {
    notify("warning", "F9のWAVカットは設定で許可してください。");
    return;
  }
  const { workspace } = editorStore.state;
  if (workspace.kind === "closed") {
    return;
  }
  const line = workspace.history.present.otoSet.lines.find(
    (entry) => entry.id === workspace.history.present.selectedId
  );
  if (line?.parsed.kind !== "oto") {
    return;
  }
  try {
    const name = workspace.session.wavs.get(line.parsed.oto.wav.toLowerCase());
    if (name === undefined) {
      throw new Error("WAVがありません。");
    }
    const wave = decodePcmWave(await workspace.session.folder.read(name));
    const duration = ((wave.channels[0]?.length ?? 0) / wave.rate) * 1000;
    await processWavs([name], {
      dc: false,
      mono: false,
      headMs: Math.max(0, line.parsed.oto.offset),
      tailMs: Math.max(0, duration - cutoffEnd(line.parsed.oto, duration)),
    });
  } catch (error) {
    notify("error", errorText(error));
  }
};
