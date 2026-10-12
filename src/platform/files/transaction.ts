/* eslint-disable no-await-in-loop -- File mutations and rollback must remain ordered. */
import type { VoiceFolder } from "./types";

export interface FileChange {
  folder?: VoiceFolder;
  name: string;
  before: Uint8Array<ArrayBuffer> | null;
  after: Uint8Array<ArrayBuffer> | null;
}
export const bytesEqual = (
  a: Uint8Array | null,
  b: Uint8Array | null
): boolean =>
  a === null || b === null
    ? a === b
    : a.length === b.length && a.every((value, i) => value === b[i]);
export const readIfExists = async (
  folder: VoiceFolder,
  name: string
): Promise<Uint8Array<ArrayBuffer> | null> =>
  (await folder.stat(name)) ? await folder.read(name) : null;
const verifyPlan = async (folder: VoiceFolder, changes: FileChange[]) => {
  for (const change of changes) {
    const target = change.folder ?? folder;
    if (!(await target.ensureWritable())) {
      throw new Error(`${target.name}への書き込みが許可されていません。`);
    }
    if (!bytesEqual(await readIfExists(target, change.name), change.before)) {
      throw new Error(
        `${change.name}が変更されています。再度操作してください。`
      );
    }
    if (change.after === null && target.remove === undefined) {
      throw new Error("この環境ではファイル名の変更に対応していません。");
    }
  }
};
const restoreChange = async (target: VoiceFolder, change: FileChange) => {
  if (bytesEqual(await readIfExists(target, change.name), change.before)) {
    return;
  }
  if (change.before === null) {
    if (target.remove === undefined) {
      if (await target.stat(change.name)) {
        throw new Error("新規ファイルを削除できません。");
      }
      return;
    }
    await target.remove(change.name);
  } else {
    await target.write(change.name, change.before);
  }
  if (!bytesEqual(await readIfExists(target, change.name), change.before)) {
    throw new Error("復帰結果が一致しません。");
  }
};
const rollback = async (
  folder: VoiceFolder,
  applied: FileChange[],
  error: unknown
) => {
  const failures: string[] = [];
  for (const change of applied.toReversed()) {
    try {
      await restoreChange(change.folder ?? folder, change);
    } catch {
      failures.push(change.name);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `復帰できないファイル: ${failures.join("、")}。同名の.bakから復元してください。`,
      { cause: error }
    );
  }
};
/** 競合検証と全バックアップを終えてから書き込み、失敗時は逆順に復帰する。 */
export const applyFileChanges = async (
  folder: VoiceFolder,
  changes: FileChange[]
): Promise<void> => {
  await verifyPlan(folder, changes);
  for (const change of changes) {
    if (change.before !== null) {
      await (change.folder ?? folder).write(
        `${change.name}.bak`,
        change.before
      );
    }
  }
  const applied: FileChange[] = [];
  try {
    for (const change of changes) {
      const target = change.folder ?? folder;
      applied.push(change);
      await (change.after === null
        ? target.remove?.(change.name)
        : target.write(change.name, change.after));
      if (!bytesEqual(await readIfExists(target, change.name), change.after)) {
        throw new Error(`${change.name}の書き込みを確認できません。`);
      }
    }
  } catch (error) {
    await rollback(folder, applied, error);
    throw error;
  }
};
