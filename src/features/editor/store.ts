import { createStore, useSelector } from "@tanstack/react-store";

import type {
  FilePlatform,
  RecoveryRecord,
  VoiceFolder,
} from "../../platform/files";
import { FileAccessError, getFilePlatform } from "../../platform/files";
import { applyFileChanges, bytesEqual } from "../../platform/files/transaction";
import type { OtoEncoding } from "../oto/encoding";
import type { OtoLine, OtoParams, OtoSet } from "../oto/oto-set";
import {
  createEmptyOtoSet,
  createLine,
  createOtoLine,
  fileStem,
  insertLines,
  parseOto,
  reinterpretEncoding,
  removeLine,
  replaceLine,
  serializeOto,
  setLineOto,
  setLineText,
  withParams,
} from "../oto/oto-set";
import { commentFileName, readComments, writeComments } from "./comments";
import type { FolderBookmark } from "./folder-bookmark";
import { rememberFolder, reopenBookmark } from "./folder-history";
import type { History } from "./history";
import {
  createHistory,
  pushState,
  redo as redoHistory,
  replacePresent,
  undo as undoHistory,
} from "./history";
import { deserializeOtoSet, serializeOtoSetForRecovery } from "./recovery-data";
import type { RecoveryData } from "./recovery-data";
import { rowFilterStore, visibleLines } from "./row-filter";

export const OTO_NAME = "oto.ini";
export const BACKUP_SUFFIX = ".bak";

/** Undo／Redoの対象。選択行も一緒に戻し、変更した行を見失わないようにする。 */
export interface Snapshot {
  otoSet: OtoSet;
  selectedId: string | null;
}

export interface Session {
  storageFolder?: VoiceFolder;
  storageBookmark?: FolderBookmark;
  commentBaseline?: Uint8Array<ArrayBuffer> | null;
  folder: VoiceFolder;
  /** 復元データの識別子。このフォルダの復元データを記録できない場合はnull。 */
  recovery: { id: string; store: FilePlatform["recovery"] } | null;
  /** フォルダ直下のWAV。小文字のファイル名から実際の名前を引く。 */
  wavs: Map<string, string>;
  /** 実際のoto.iniのファイル名（大文字小文字を保つ）。 */
  otoName: string;
  /** 読み込み・保存した時点のoto.iniのバイト列。ファイルがなければnull。 */
  baseline: Awaited<ReturnType<VoiceFolder["read"]>> | null;
  /** 最後に保存（または読み込み）した状態。 */
  savedOtoSet: OtoSet;
}

export interface Notice {
  tone: "info" | "warning" | "error";
  text: string;
}

export interface DialogAction {
  id: string;
  label: string;
  tone?: "primary" | "danger" | "default";
}

export interface DialogRequest {
  title: string;
  message: string;
  actions: DialogAction[];
  resolve: (actionId: string) => void;
}

export interface EditorState {
  workspace: Workspace;
  /** 先行発声を動かすとき他のマーカーも動かして相対位置を保つ。 */
  linked: boolean;
  busy: string;
  notice: Notice | null;
  /** 復元データを保存できない状態。解消するまで表示し続ける。 */
  recoveryError: string;
  dialog: DialogRequest | null;
  recoveries: RecoveryRecord[];
}

export type Workspace =
  | { kind: "closed" }
  | { kind: "open"; session: Session; history: History<Snapshot> };
export type OpenWorkspace = Extract<Workspace, { kind: "open" }>;

export const editorStore = createStore<EditorState>({
  workspace: { kind: "closed" },
  busy: "",
  dialog: null,
  linked: false,
  notice: null,
  recoveries: [],
  recoveryError: "",
});

export const useEditor = <T>(selector: (state: EditorState) => T): T =>
  useSelector(editorStore, selector);

const get = (): EditorState => editorStore.state;
const set = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)
): void => {
  editorStore.setState((state) => ({
    ...state,
    ...(typeof update === "function" ? update(state) : update),
  }));
};

export const selectIsDirty = ({ workspace }: EditorState): boolean =>
  workspace.kind === "open" &&
  workspace.history.present.otoSet !== workspace.session.savedOtoSet;

/** 閉じた状態へ編集データを作らず、変更のない操作では同じ参照を保つ。 */
const updateWorkspace = (
  update: (workspace: OpenWorkspace) => OpenWorkspace
): void => {
  editorStore.setState((state) => {
    if (state.workspace.kind === "closed") {
      return state;
    }
    const workspace = update(state.workspace);
    return workspace === state.workspace ? state : { ...state, workspace };
  });
};

export const notify = (tone: Notice["tone"], text: string): void => {
  set({ notice: { text, tone } });
};

export const ask = async (
  request: Omit<DialogRequest, "resolve">
): Promise<string> => {
  const { promise, resolve } = Promise.withResolvers<string>();
  set({
    dialog: {
      ...request,
      resolve: (actionId) => {
        set({ dialog: null });
        resolve(actionId);
      },
    },
  });
  return await promise;
};

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * 現在の入力欄の編集を確定させる。React Ariaの入力欄はフォーカスを外したときに値を確定し、
 * その処理はblurの中で同期的に終わる。
 */
const commitActiveInput = (): void => {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches("input, textarea")) {
    active.blur();
  }
};

const commit = (workspace: OpenWorkspace, next: Snapshot): OpenWorkspace => {
  const { present } = workspace.history;
  if (
    next.otoSet === present.otoSet &&
    next.selectedId === present.selectedId
  ) {
    return workspace;
  }
  return { ...workspace, history: pushState(workspace.history, next) };
};

const nearestRemaining = (present: Snapshot, otoSet: OtoSet): string | null => {
  if (otoSet.lines.some((line) => line.id === present.selectedId)) {
    return present.selectedId;
  }
  const remaining = new Set(
    otoSet.lines
      .filter((line) => line.parsed.kind === "oto")
      .map((line) => line.id)
  );
  const previous = present.otoSet.lines;
  const index = previous.findIndex((line) => line.id === present.selectedId);
  const candidates = [
    ...previous.slice(index + 1),
    ...previous.slice(0, Math.max(index, 0)).toReversed(),
  ];
  return (
    candidates.find((line) => remaining.has(line.id))?.id ??
    otoSet.lines.find((line) => remaining.has(line.id))?.id ??
    null
  );
};

/** 範囲編集も1回の履歴として保存する。元の行・バイトは未変更行で維持する。 */
export const transformOtoSet = (
  transform: (otoSet: OtoSet) => OtoSet
): void => {
  updateWorkspace((workspace) => {
    const { present } = workspace.history;
    const otoSet = transform(present.otoSet);
    if (otoSet === present.otoSet) {
      return workspace;
    }
    return commit(workspace, {
      otoSet,
      selectedId: nearestRemaining(present, otoSet),
    });
  });
};

export const updateManyParams = (
  changes: ReadonlyMap<string, Partial<OtoParams>>
): void => {
  transformOtoSet((otoSet) => {
    let next = otoSet;
    for (const [id, params] of changes) {
      next = replaceLine(next, id, (line) =>
        line.parsed.kind === "oto"
          ? setLineOto(line, withParams(line.parsed.oto, params))
          : line
      );
    }
    return next;
  });
};

export const select = (selectedId: OtoLine["id"]): void => {
  updateWorkspace((workspace) => {
    const { present } = workspace.history;
    if (
      present.selectedId === selectedId ||
      !present.otoSet.lines.some((line) => line.id === selectedId)
    ) {
      return workspace;
    }
    return {
      ...workspace,
      history: replacePresent(workspace.history, { ...present, selectedId }),
    };
  });
};

const editLine = (
  lineId: OtoLine["id"],
  update: (line: OtoLine) => OtoLine
): void => {
  updateWorkspace((workspace) => {
    const { present } = workspace.history;
    const otoSet = replaceLine(present.otoSet, lineId, update);
    return otoSet === present.otoSet
      ? workspace
      : commit(workspace, { ...present, otoSet });
  });
};

export const updateParams = (
  lineId: OtoLine["id"],
  changes: Partial<OtoParams>
): void => {
  editLine(lineId, (line) =>
    line.parsed.kind === "oto"
      ? setLineOto(line, withParams(line.parsed.oto, changes))
      : line
  );
};
export const updateAlias = (lineId: OtoLine["id"], alias: string): void => {
  editLine(lineId, (line) =>
    line.parsed.kind === "oto" && line.parsed.oto.alias !== alias
      ? setLineOto(line, { ...line.parsed.oto, alias })
      : line
  );
};
export const updateLineText = (lineId: OtoLine["id"], text: string): void => {
  editLine(lineId, (line) => setLineText(line, text));
};

export interface MarkerPreview {
  lineId: OtoLine["id"];
  params: OtoParams;
}
export const markerPreviewStore = createStore<MarkerPreview | null>(null);
export const setMarkerPreview = (preview: MarkerPreview): void => {
  markerPreviewStore.setState(() => preview);
};
export const clearMarkerPreview = (): void => {
  markerPreviewStore.setState(() => null);
};
/** 選択行の設定を再利用し、ドラッグしている間だけ仮の設定を返す。 */
export const useMarkerParams = (
  lineId: OtoLine["id"],
  params: OtoParams
): OtoParams =>
  useSelector(markerPreviewStore, (preview) =>
    preview?.lineId === lineId ? preview.params : params
  );

export const undo = (): void => {
  updateWorkspace((workspace) => {
    const history = undoHistory(workspace.history);
    return history === workspace.history
      ? workspace
      : { ...workspace, history };
  });
};
export const redo = (): void => {
  updateWorkspace((workspace) => {
    const history = redoHistory(workspace.history);
    return history === workspace.history
      ? workspace
      : { ...workspace, history };
  });
};
export const setEncoding = (encoding: OtoEncoding): void => {
  updateWorkspace((workspace) => {
    const { present } = workspace.history;
    const otoSet = reinterpretEncoding(present.otoSet, encoding);
    return otoSet === present.otoSet
      ? workspace
      : commit(workspace, { ...present, otoSet });
  });
};

export const addLine = (wav: string): void => {
  updateWorkspace((workspace) => {
    const { otoSet, selectedId } = workspace.history.present;
    const index = otoSet.lines.findIndex((line) => line.id === selectedId);
    const line = createOtoLine(wav, fileStem(wav));
    return commit(workspace, {
      otoSet: insertLines(
        otoSet,
        index === -1 ? otoSet.lines.length : index + 1,
        [line]
      ),
      selectedId: line.id,
    });
  });
};
export const duplicateLine = (lineId: OtoLine["id"]): void => {
  updateWorkspace((workspace) => {
    const { otoSet } = workspace.history.present;
    const index = otoSet.lines.findIndex((line) => line.id === lineId);
    const source = otoSet.lines[index];
    if (!source) {
      return workspace;
    }
    const copy = { ...createLine(source.text), comment: source.comment };
    return commit(workspace, {
      otoSet: insertLines(otoSet, index + 1, [copy]),
      selectedId: copy.id,
    });
  });
};
export const deleteLine = (lineId: OtoLine["id"]): void => {
  updateWorkspace((workspace) => {
    const { otoSet } = workspace.history.present;
    const index = otoSet.lines.findIndex((line) => line.id === lineId);
    const next = removeLine(otoSet, lineId);
    if (next === otoSet) {
      return workspace;
    }
    const neighbor = next.lines[Math.min(index, next.lines.length - 1)];
    return commit(workspace, {
      otoSet: next,
      selectedId: neighbor?.id ?? null,
    });
  });
};

/** oto.iniに行がないWAVだけを追加する。初期値は自動推定ではない。 */
export const addLinesForUnlistedWavs = (): number => {
  let added = 0;
  updateWorkspace((workspace) => {
    const { otoSet, selectedId } = workspace.history.present;
    const listed = new Set(
      otoSet.lines.flatMap((line) =>
        line.parsed.kind === "oto" ? [line.parsed.oto.wav.toLowerCase()] : []
      )
    );
    const lines = [...workspace.session.wavs.values()]
      .filter((name) => !listed.has(name.toLowerCase()))
      .toSorted((a, b) => a.localeCompare(b, "ja"))
      .map((name) => createOtoLine(name, fileStem(name)));
    added = lines.length;
    if (added === 0) {
      return workspace;
    }
    return commit(workspace, {
      otoSet: insertLines(otoSet, otoSet.lines.length, lines),
      selectedId: selectedId ?? lines[0]?.id ?? null,
    });
  });
  return added;
};

/** ブラウザがフォルダ経由のiniアクセスを拒否したときに、既存のiniを選ぶか新しく作るかを利用者に決めてもらう。 */
const chooseRestrictedIni = async (
  folder: VoiceFolder,
  otoName: string
): Promise<{ name: string; created: boolean }> => {
  const choice = await ask({
    title: "iniファイルを選んでください",
    message: folder.createIni
      ? "ブラウザがフォルダ内のiniファイルの読み書きを制限しているため、ファイルを個別に選んでください。oto.iniがある場合は「iniファイルを選ぶ」、まだない場合は「新しく作る」を選びます。「新しく作る」で既存のファイルを選ぶと、その中身は消えます。"
      : "ブラウザがフォルダ内のiniファイルの読み書きを制限しているため、音源フォルダの直下にあるoto.iniなどの原音設定を個別に選んでください。",
    actions: [
      { id: "select", label: "iniファイルを選ぶ" },
      ...(folder.createIni ? [{ id: "create", label: "新しく作る" }] : []),
      { id: "cancel", label: "キャンセル" },
    ],
  });
  let picked: string | null = null;
  if (choice === "select") {
    picked = (await folder.pickIni?.()) ?? null;
  } else if (choice === "create") {
    picked = (await folder.createIni?.(otoName)) ?? null;
  }
  if (picked === null) {
    throw new FileAccessError(
      "cancelled",
      "原音設定の読み込みをキャンセルしました。"
    );
  }
  return { name: picked, created: choice === "create" };
};

const openNotice = (
  otoName: string,
  baseline: Session["baseline"],
  created: boolean
): Notice | null => {
  if (created) {
    return { text: `空の${otoName}を作成しました。`, tone: "info" };
  }
  if (baseline === null) {
    return {
      text: "oto.iniがないため、新しく作成します。保存するまでファイルは作られません。",
      tone: "info",
    };
  }
  return null;
};

export const openVoiceFolder = async (
  folder: VoiceFolder,
  platform: FilePlatform,
  requestedName?: string
): Promise<Session> => {
  set({ busy: "フォルダを読み込んでいます" });
  try {
    const files = await folder.listFiles();
    const wavs = new Map(
      files
        .filter((name) => name.toLowerCase().endsWith(".wav"))
        .map((name) => [name.toLowerCase(), name])
    );
    let otoName =
      requestedName ??
      files.find((name) => name.toLowerCase() === OTO_NAME) ??
      OTO_NAME;
    let baseline: Session["baseline"];
    let created = false;
    try {
      baseline = (await folder.stat(otoName))
        ? await folder.read(otoName)
        : null;
    } catch (error) {
      if (
        !(error instanceof FileAccessError) ||
        error.kind !== "permission" ||
        !folder.pickIni
      ) {
        throw error;
      }
      ({ created, name: otoName } = await chooseRestrictedIni(folder, otoName));
      baseline = await folder.read(otoName);
    }
    let otoSet =
      baseline && !created ? parseOto(baseline) : createEmptyOtoSet();
    const commentName = commentFileName(otoName);
    const commentBaseline = files.includes(commentName)
      ? await folder.read(commentName)
      : null;
    if (commentBaseline !== null) {
      otoSet = readComments(otoSet, commentBaseline);
    }
    let recovery: Session["recovery"] = null;
    let recoveryError = "";
    try {
      recovery = {
        id: await platform.recovery.idFor(folder),
        store: platform.recovery,
      };
    } catch (error) {
      // 復元データを記録できなくても編集と明示保存はできる。記録できないことは表示し続ける。
      recoveryError = `このフォルダの復元データは記録できません: ${errorText(error)}`;
    }
    rowFilterStore.setState(() => null);
    const firstOto = otoSet.lines.find((line) => line.parsed.kind === "oto");
    const session: Session = {
      commentBaseline,
      baseline,
      folder,
      otoName,
      recovery,
      savedOtoSet: otoSet,
      wavs,
    };
    set({
      workspace: {
        kind: "open",
        session,
        history: createHistory({ otoSet, selectedId: firstOto?.id ?? null }),
      },
      notice: openNotice(otoName, baseline, created),
      recoveryError,
    });
    if (otoSet.encodingCertainty === "invalid") {
      notify(
        "warning",
        "oto.iniの文字コードを判定できませんでした。表示が崩れている場合は文字コードを切り替えてください。"
      );
    }
    try {
      await rememberFolder(folder);
    } catch {
      notify("warning", "フォルダ履歴を保存できません。編集は継続できます。");
    }
    return session;
  } finally {
    set({ busy: "" });
  }
};

const digest = async (bytes: Session["baseline"]): Promise<string | null> => {
  if (!bytes) {
    return null;
  }
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const clearRecovery = async (session: Session): Promise<void> => {
  if (session.recovery === null) {
    return;
  }
  try {
    await session.recovery.store.remove(session.recovery.id);
    set({ recoveryError: "" });
  } catch (error) {
    set({ recoveryError: `復元データを削除できません: ${errorText(error)}` });
  }
};

const hasLineComments = (otoSet: OtoSet) =>
  otoSet.lines.some((line) => (line.comment ?? "") !== "");
/**
 * oto.iniへ明示的に保存する。外部での変更を確認し、元の内容をバックアップしてから書き、読み戻して一致を確かめる。
 * どこかで失敗した場合は未保存状態を残す。
 */
export const save = async (): Promise<boolean> => {
  commitActiveInput();
  const { workspace, busy } = get();
  if (workspace.kind === "closed" || busy !== "") {
    return false;
  }
  const { session, history } = workspace;
  const { otoSet } = history.present;
  const serialized = serializeOto(otoSet);
  if (!serialized.ok) {
    const [first] = serialized.issues;
    if (first) {
      select(first.lineId);
    }
    const characters = [
      ...new Set(serialized.issues.flatMap((issue) => issue.characters)),
    ].join(" ");
    notify(
      "error",
      `${serialized.issues.length}行に保存できない文字があります（${characters}）。文字を直すか、文字コードを変えてください。`
    );
    return false;
  }
  set({ busy: "保存しています" });
  try {
    const { otoName } = session;
    const folder = session.storageFolder ?? session.folder;
    if (!(await folder.ensureWritable())) {
      throw new FileAccessError(
        "permission",
        "フォルダへの書き込みが許可されていません。"
      );
    }
    const current = (await folder.stat(otoName))
      ? await folder.read(otoName)
      : null;
    if (!bytesEqual(current, session.baseline)) {
      const choice = await ask({
        actions: [
          { id: "overwrite", label: "上書きする", tone: "danger" },
          { id: "cancel", label: "キャンセル" },
        ],
        message:
          current === null
            ? `${otoName}が他のアプリで削除されています。編集中の内容で作成しますか。`
            : `${otoName}が開いた後に他のアプリで変更されています。上書きすると他のアプリの変更は失われます（変更前の内容は${otoName}${BACKUP_SUFFIX}に残します）。`,
        title: "元ファイルが変更されています",
      });
      if (choice !== "overwrite") {
        return false;
      }
    }
    const commentName = commentFileName(otoName);
    const currentComments = (await folder.stat(commentName))
      ? await folder.read(commentName)
      : null;
    const hasComments = currentComments !== null || hasLineComments(otoSet);
    const commentBytes = hasComments ? writeComments(otoSet) : null;
    if (
      !bytesEqual(currentComments, session.commentBaseline ?? null) &&
      (await ask({
        title: "コメントファイルが変更されています",
        message: `${commentName}を編集内容で上書きしますか。`,
        actions: [
          { id: "overwrite", label: "上書きする", tone: "danger" },
          { id: "cancel", label: "キャンセル" },
        ],
      })) !== "overwrite"
    ) {
      return false;
    }
    await applyFileChanges(folder, [
      { name: otoName, before: current, after: serialized.bytes },
      ...(hasComments
        ? [{ name: commentName, before: currentComments, after: commentBytes }]
        : []),
    ]);
    updateWorkspace((opened) =>
      opened.session === session
        ? {
            ...opened,
            session: {
              ...session,
              baseline: serialized.bytes,
              commentBaseline: commentBytes,
              savedOtoSet: otoSet,
            },
          }
        : opened
    );
    notify("info", `${otoName}を保存しました。`);
    if (!selectIsDirty(get())) {
      await clearRecovery(session);
    }
    return true;
  } catch (error) {
    notify(
      "error",
      `保存できませんでした。編集内容は残っています。${errorText(error)}`
    );
    return false;
  } finally {
    set({ busy: "" });
  }
};

/** 未保存の変更があれば、保存・破棄・キャンセルを選ばせる。続行してよければtrue。 */
export const confirmDiscardChanges = async (
  action: string
): Promise<boolean> => {
  if (!selectIsDirty(get())) {
    return true;
  }
  const choice = await ask({
    actions: [
      { id: "save", label: "保存", tone: "primary" },
      { id: "discard", label: "保存しない", tone: "danger" },
      { id: "cancel", label: "キャンセル" },
    ],
    message: `${action}前に、未保存の変更を保存しますか。`,
    title: "未保存の変更があります",
  });
  if (choice === "save") {
    return await save();
  }
  if (choice === "discard") {
    const { workspace } = get();
    if (workspace.kind === "open") {
      await clearRecovery(workspace.session);
    }
    return true;
  }
  return false;
};

export const openFolder = async (): Promise<void> => {
  if (!(await confirmDiscardChanges("別のフォルダを開く"))) {
    return;
  }
  try {
    const platform = await getFilePlatform();
    const folder = await platform.pickFolder();
    if (folder) {
      await openVoiceFolder(folder, platform);
    }
  } catch (error) {
    notify("error", errorText(error));
  }
};

const hasControlCharacters = (name: string): boolean => {
  for (let i = 0; i < name.length; i += 1) {
    if ((name.codePointAt(i) ?? 0) < 32) {
      return true;
    }
  }
  return false;
};
export const validIniName = (name: string): boolean =>
  name.trim() !== "" &&
  !/[\\/<>:"|?*]/u.test(name) &&
  !hasControlCharacters(name) &&
  name.toLowerCase().endsWith(".ini");
export const openIni = async (name: string): Promise<boolean> => {
  if (!validIniName(name)) {
    notify("error", "フォルダ直下のiniファイル名を指定してください。");
    return false;
  }
  if (!(await confirmDiscardChanges("別の原音設定を開く"))) {
    return false;
  }
  const { workspace } = get();
  if (workspace.kind === "closed") {
    return false;
  }
  try {
    await openVoiceFolder(
      workspace.session.folder,
      await getFilePlatform(),
      name
    );
    return true;
  } catch (error) {
    notify("error", `読み込めません: ${errorText(error)}`);
    return false;
  }
};
export const saveAs = async (
  name: string,
  destination?: VoiceFolder
): Promise<boolean> => {
  commitActiveInput();
  const { workspace, busy } = get();
  if (workspace.kind === "closed" || busy !== "") {
    return false;
  }
  if (!validIniName(name)) {
    notify("error", "フォルダ直下のiniファイル名を指定してください。");
    return false;
  }
  if (
    name === workspace.session.otoName &&
    (destination === undefined ||
      destination ===
        (workspace.session.storageFolder ?? workspace.session.folder))
  ) {
    return await save();
  }
  const oldSession = workspace.session;
  const storageFolder = destination ?? oldSession.storageFolder;
  let { storageBookmark } = oldSession;
  if (destination !== undefined) {
    try {
      storageBookmark = (await rememberFolder(destination)) ?? {
        id: crypto.randomUUID(),
        name: destination.name,
        nativePath: destination.bookmark ?? null,
      };
    } catch (error) {
      notify("warning", `保存先履歴を記録できません: ${errorText(error)}`);
    }
  }
  const newSession = {
    ...oldSession,
    storageFolder,
    storageBookmark,
    otoName: name,
    baseline: null,
    commentBaseline: null,
  };
  updateWorkspace((opened) => ({ ...opened, session: newSession }));
  const success = await save();
  if (!success) {
    updateWorkspace((opened) => ({ ...opened, session: oldSession }));
  }
  return success;
};

/** 未保存の編集内容を復元データとして記録する。元のoto.iniは更新しない。 */
export const writeRecovery = async (): Promise<void> => {
  const state = get();
  const { workspace } = state;
  if (workspace.kind === "closed" || workspace.session.recovery === null) {
    return;
  }
  const { session, history } = workspace;
  const { recovery } = workspace.session;
  if (!selectIsDirty(state)) {
    await clearRecovery(session);
    return;
  }
  const data: RecoveryData = {
    baselineHash: await digest(session.baseline),
    storageBookmark: session.storageBookmark,
    otoName: session.otoName,
    otoSet: serializeOtoSetForRecovery(history.present.otoSet),
  };
  try {
    await recovery.store.save(session.folder, {
      data,
      folderName: session.folder.name,
      id: recovery.id,
      savedAt: Date.now(),
    });
    set({ recoveryError: "" });
  } catch (error) {
    set({ recoveryError: errorText(error) });
  }
};

export const refreshRecoveries = async (): Promise<void> => {
  try {
    const platform = await getFilePlatform();
    const records = await platform.recovery.list();
    set({ recoveries: records.toSorted((a, b) => b.savedAt - a.savedAt) });
  } catch (error) {
    notify("error", `復元データを読めません: ${errorText(error)}`);
  }
};

export const discardRecovery = async (id: string): Promise<void> => {
  try {
    const platform = await getFilePlatform();
    await platform.recovery.remove(id);
  } catch (error) {
    notify("error", `復元データを削除できません: ${errorText(error)}`);
  }
  await refreshRecoveries();
};

/**
 * 復元データからフォルダを開き直す。アクセスを取り戻せなければフォルダの再選択を求め、
 * 元ファイルが記録時から変わっていれば利用者に確認する。
 */
const restoreFromRecord = async (id: string): Promise<boolean> => {
  const platform = await getFilePlatform();
  const records = await platform.recovery.list();
  const record = records.find((candidate) => candidate.id === id);
  if (!record) {
    return false;
  }
  try {
    const { data } = record;
    let folder = await platform.recovery.reopen(id);
    if (!folder) {
      const choice = await ask({
        actions: [
          { id: "pick", label: "フォルダを選ぶ", tone: "primary" },
          { id: "cancel", label: "キャンセル" },
        ],
        message: `「${record.folderName}」へのアクセスを確認できませんでした。同じフォルダを選び直してください。`,
        title: "フォルダの再許可が必要です",
      });
      if (choice !== "pick") {
        return false;
      }
      folder = await platform.pickFolder();
      if (!folder) {
        return false;
      }
      if ((await platform.recovery.idFor(folder)) !== id) {
        const confirm = await ask({
          actions: [
            { id: "continue", label: "このフォルダに復元する", tone: "danger" },
            { id: "cancel", label: "キャンセル" },
          ],
          message: `選んだフォルダ「${folder.name}」は記録したフォルダ「${record.folderName}」と一致しません。`,
          title: "別のフォルダです",
        });
        if (confirm !== "continue") {
          return false;
        }
      }
    }
    let session = await openVoiceFolder(folder, platform, data.otoName);
    if (data.storageBookmark !== undefined) {
      let storageFolder = await reopenBookmark(data.storageBookmark);
      if (storageFolder === null) {
        if (
          (await ask({
            title: "保存先フォルダを再選択",
            message: `保存先「${data.storageBookmark.name}」へのアクセスを取り戻せません。保存先フォルダを選択してください。`,
            actions: [
              { id: "pick", label: "保存先を選択", tone: "primary" },
              { id: "cancel", label: "キャンセル" },
            ],
          })) !== "pick"
        ) {
          return false;
        }
        storageFolder = await platform.pickFolder();
        if (storageFolder === null) {
          return false;
        }
      }
      const baseline = (await storageFolder.stat(data.otoName))
        ? await storageFolder.read(data.otoName)
        : null;
      const commentName = commentFileName(data.otoName);
      const commentBaseline = (await storageFolder.stat(commentName))
        ? await storageFolder.read(commentName)
        : null;
      session = {
        ...session,
        storageFolder,
        storageBookmark:
          (await rememberFolder(storageFolder)) ?? data.storageBookmark,
        baseline,
        commentBaseline,
      };
      updateWorkspace((opened) => ({ ...opened, session }));
    }
    if ((await digest(session.baseline)) !== data.baselineHash) {
      const choice = await ask({
        actions: [
          { id: "restore", label: "復元する", tone: "primary" },
          { id: "cancel", label: "復元しない" },
        ],
        message: `${session.otoName}は復元データの記録後に変更されています。復元すると、保存時にその変更を上書きします。`,
        title: "元ファイルが変更されています",
      });
      if (choice !== "restore") {
        return false;
      }
    }
    const otoSet = deserializeOtoSet(data.otoSet);
    const firstOto = otoSet.lines.find((line) => line.parsed.kind === "oto");
    updateWorkspace((workspace) =>
      commit(workspace, { otoSet, selectedId: firstOto?.id ?? null })
    );
    if (session.recovery?.id !== id) {
      // 別のフォルダへ復元した場合は、以後そのフォルダの識別子で記録し直す。
      await platform.recovery.remove(id);
    }
    await writeRecovery();
    notify(
      "info",
      "未保存の編集内容を復元しました。保存するまで元ファイルは変わりません。"
    );
    return true;
  } catch (error) {
    notify("error", `復元できませんでした: ${errorText(error)}`);
    return false;
  }
};

const lineWav = (line: OtoLine | undefined): string | null =>
  line?.parsed.kind === "oto" ? line.parsed.oto.wav.toLowerCase() : null;

export const selectRelative = (delta: number): void => {
  const { workspace } = get();
  if (workspace.kind === "closed") {
    return;
  }
  const { otoSet, selectedId } = workspace.history.present;
  const lines = visibleLines(otoSet);
  const index = lines.findIndex((line) => line.id === selectedId);
  const next = lines[Math.max(0, Math.min(lines.length - 1, index + delta))];
  if (next) {
    select(next.id);
  }
};

/** 別のWAVを参照する前後の行へ移動する（同じWAVの行は飛ばす）。 */
export const selectRelativeWav = (delta: 1 | -1): void => {
  const { workspace } = get();
  if (workspace.kind === "closed") {
    return;
  }
  const { otoSet, selectedId } = workspace.history.present;
  const lines = visibleLines(otoSet);
  let index = lines.findIndex((line) => line.id === selectedId);
  const current = lineWav(lines[index]);
  while (index + delta >= 0 && index + delta < lines.length) {
    index += delta;
    if (lineWav(lines[index]) !== current) {
      break;
    }
  }
  const target = lines[index];
  if (target) {
    select(target.id);
  }
};

/** 復元データから編集を再開する。復元しなかった場合は一覧を読み直す。 */
export const restoreRecovery = async (id: string): Promise<boolean> => {
  const restored = await restoreFromRecord(id);
  if (!restored) {
    await refreshRecoveries();
  }
  return restored;
};
