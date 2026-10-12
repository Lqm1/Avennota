import { FileAccessError } from "../../platform/files";
import {
  applyFileChanges,
  bytesEqual,
  readIfExists,
} from "../../platform/files/transaction";
import type { FileChange } from "../../platform/files/transaction";
import type { OtoSet } from "../oto/oto-set";
import { serializeOto } from "../oto/oto-set";
import { commentFileName, writeComments } from "./comments";
import { ask, validIniName, withBusy } from "./store";
import type { Session } from "./store";

export const writeSubset = async (
  session: Session,
  requestedName: string,
  subset: OtoSet
): Promise<string | null> => {
  const isCurrent = (name: string) =>
    name.toLowerCase() === session.otoName.toLowerCase();
  if (!validIniName(requestedName) || isCurrent(requestedName)) {
    throw new Error(
      "編集中のiniとは別の、フォルダ直下のiniファイル名を指定してください。"
    );
  }
  const serialized = serializeOto(subset);
  if (!serialized.ok) {
    throw new Error(
      "保存できない文字がある行が含まれています。文字を直すか、文字コードを変えてください。"
    );
  }
  const { folder } = session;
  if (!(await folder.ensureWritable())) {
    throw new FileAccessError(
      "permission",
      "フォルダへの書き込みが許可されていません。"
    );
  }
  let name = requestedName;
  let current: Uint8Array<ArrayBuffer> | null = null;
  let created = false;
  try {
    current = await readIfExists(session.folder, name);
  } catch (error) {
    if (
      !(error instanceof FileAccessError) ||
      error.kind !== "permission" ||
      folder.createIni === undefined
    ) {
      throw error;
    }
    const picked = await folder.createIni(name);
    if (picked === null) {
      return null;
    }
    if (isCurrent(picked)) {
      // 保存ダイアログが選んだ時点で空にしたため、読み込み時の内容へ戻す。
      if (session.baseline !== null) {
        await folder.write(picked, session.baseline);
      }
      throw new Error("編集中のiniには書き出せません。", { cause: error });
    }
    name = picked;
    created = true;
  }
  if (
    current !== null &&
    (await ask({
      title: "iniを上書きしますか",
      message: `${name}は既にあります。抽出した行で上書きします（元の内容は${name}.bakに残します）。`,
      actions: [
        { id: "overwrite", label: "上書きする", tone: "danger" },
        { id: "cancel", label: "キャンセル" },
      ],
    })) !== "overwrite"
  ) {
    return null;
  }
  const changes: FileChange[] = created
    ? []
    : [{ name, before: current, after: serialized.bytes }];
  if (subset.lines.some((line) => (line.comment ?? "") !== "")) {
    const commentName = commentFileName(name);
    changes.push({
      name: commentName,
      before: await readIfExists(session.folder, commentName),
      after: writeComments(subset),
    });
  }
  await withBusy("iniを書き出しています", async () => {
    if (created) {
      await folder.write(name, serialized.bytes);
      if (!bytesEqual(await folder.read(name), serialized.bytes)) {
        throw new Error(`${name}の書き込みを確認できません。`);
      }
    }
    await applyFileChanges(folder, changes);
  });
  return name;
};
