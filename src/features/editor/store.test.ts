import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FilePlatform,
  RecoveryRecord,
  VoiceFolder,
} from "../../platform/files";
import { FileAccessError } from "../../platform/files";
import {
  durationStore,
  EMPTY_DURATIONS,
  setDuration,
} from "../audio/wav-cache";
import { encodePcmWave, decodePcmWave } from "../audio/wav-processing";
import { isOtoLine } from "../oto/oto-set";
import { pasteCells } from "./bulk-edit";
import { processWavs, renameWavs } from "./file-tools";
import { recoveryRecordSchema } from "./recovery-data";
import { buildRows } from "./rows";
import {
  addLine,
  addLinesForUnlistedWavs,
  deleteLine,
  deleteLineKeepingWav,
  duplicateLine,
  editorStore,
  openVoiceFolder,
  redo,
  save,
  saveAs,
  transformOtoSet,
  select,
  selectIsDirty,
  setEncoding,
  undo,
  updateAlias,
  updateParams,
  writeRecovery,
} from "./store";

const INITIAL_STATE = editorStore.state;
const SOURCE = new TextEncoder().encode(
  "a.wav=a,1.000,2,-30,4,5\r\nb.wav=b,1,2,3,4,5\r\n"
);

class MemoryFolder implements VoiceFolder {
  readonly name = "音源";
  readonly files = new Map<string, Uint8Array<ArrayBuffer>>([
    ["oto.ini", SOURCE],
    ["a.wav", new Uint8Array()],
    ["b.wav", new Uint8Array()],
  ]);
  writable = true;
  readonly failedWrites = new Set<string>();
  async remove(name: string) {
    this.files.delete(name);
    await Promise.resolve();
  }
  async ensureWritable() {
    return await Promise.resolve(this.writable);
  }
  async listFiles() {
    return await Promise.resolve([...this.files.keys()]);
  }
  async read(name: string) {
    const bytes = this.files.get(name);
    if (bytes === undefined) {
      throw new FileAccessError("not-found", name);
    }
    return await Promise.resolve(bytes);
  }
  async stat(name: string) {
    const bytes = this.files.get(name);
    return await Promise.resolve(
      bytes === undefined ? null : { size: bytes.length, modifiedAt: 0 }
    );
  }
  async write(name: string, bytes: Uint8Array<ArrayBuffer>) {
    if (this.failedWrites.has(name)) {
      throw new FileAccessError("write", "書き込み失敗");
    }
    this.files.set(name, bytes);
    await Promise.resolve();
  }
}

const fixture = () => {
  const folder = new MemoryFolder();
  const records = new Map<string, RecoveryRecord>();
  const platform: FilePlatform = {
    kind: "browser",
    pickFolder: async () => await Promise.resolve(folder),
    recovery: {
      idFor: async () => await Promise.resolve("fixture"),
      list: async () => await Promise.resolve([...records.values()]),
      reopen: async () => await Promise.resolve(folder),
      remove: async (id) => {
        records.delete(id);
        await Promise.resolve();
      },
      save: async (_, record) => {
        const json = JSON.stringify(record);
        records.set(record.id, recoveryRecordSchema.parse(JSON.parse(json)));
        await Promise.resolve();
      },
    },
  };
  return { folder, platform, records };
};
const opened = () => {
  const { workspace } = editorStore.state;
  if (workspace.kind !== "open") {
    throw new Error("編集状態ではありません");
  }
  return workspace;
};
const firstLine = () => {
  const line = opened().history.present.otoSet.lines.find(isOtoLine);
  if (line === undefined) {
    throw new Error("原音設定行がありません");
  }
  return line;
};

describe("編集状態と保存", () => {
  beforeEach(() => {
    editorStore.setState(() => INITIAL_STATE);
    // 保存前にDOMの入力を確定する境界だけを置き換える。ファイル・履歴・保存処理は実装を動かす。
    vi.stubGlobal("document", { activeElement: null });
    vi.stubGlobal("HTMLElement", Object);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("閉じた状態の編集操作は仮の履歴を作らない", () => {
    undo();
    redo();
    addLine("a.wav");
    updateParams("missing", { offset: 1 });
    expect(editorStore.state).toBe(INITIAL_STATE);
    expect(selectIsDirty(editorStore.state)).toBeFalsy();
  });

  it("フォルダ一覧から隠されたiniを新規ファイルと判断しない", async () => {
    const { folder, platform } = fixture();
    vi.spyOn(folder, "listFiles").mockResolvedValue(["a.wav", "b.wav"]);
    await openVoiceFolder(folder, platform);
    expect(opened().session.baseline).toStrictEqual(SOURCE);
    expect(
      opened().history.present.otoSet.lines.filter(isOtoLine)
    ).toHaveLength(2);
  });

  it("iniアクセスが制限されたら個別選択で読んだ内容を保存しバックアップする", async () => {
    const { folder, platform } = fixture();
    vi.spyOn(folder, "listFiles").mockResolvedValue(["a.wav", "b.wav"]);
    vi.spyOn(folder, "stat").mockRejectedValueOnce(
      new FileAccessError("permission", "Name is not allowed")
    );
    const selectedFolder: VoiceFolder = {
      name: folder.name,
      listFiles: folder.listFiles.bind(folder),
      stat: folder.stat.bind(folder),
      read: folder.read.bind(folder),
      write: folder.write.bind(folder),
      ensureWritable: folder.ensureWritable.bind(folder),
      pickIni: async () => await Promise.resolve("oto.ini"),
    };
    const opening = openVoiceFolder(selectedFolder, platform);
    await vi.waitFor(() => {
      expect(editorStore.state.dialog?.title).toBe(
        "iniファイルを選んでください"
      );
    });
    editorStore.state.dialog?.resolve("select");
    await opening;
    updateAlias(firstLine().id, "選択後");
    await expect(save()).resolves.toBeTruthy();
    expect(folder.files.get("oto.ini.bak")).toStrictEqual(SOURCE);
    expect(selectIsDirty(editorStore.state)).toBeFalsy();
  });

  it("iniアクセスが制限されたら新しく作ったiniへ保存できる", async () => {
    const { folder, platform } = fixture();
    folder.files.delete("oto.ini");
    vi.spyOn(folder, "listFiles").mockResolvedValue(["a.wav", "b.wav"]);
    vi.spyOn(folder, "stat").mockRejectedValueOnce(
      new FileAccessError("permission", "Name is not allowed")
    );
    const selectedFolder: VoiceFolder = {
      name: folder.name,
      listFiles: folder.listFiles.bind(folder),
      stat: folder.stat.bind(folder),
      read: folder.read.bind(folder),
      write: folder.write.bind(folder),
      ensureWritable: folder.ensureWritable.bind(folder),
      pickIni: async () => await Promise.resolve(null),
      createIni: async (name) => {
        folder.files.set(name, new Uint8Array());
        return await Promise.resolve(name);
      },
    };
    const opening = openVoiceFolder(selectedFolder, platform);
    await vi.waitFor(() => {
      expect(editorStore.state.dialog).not.toBeNull();
    });
    editorStore.state.dialog?.resolve("create");
    await opening;
    expect(opened().session.otoName).toBe("oto.ini");
    expect(opened().history.present.otoSet.lines).toHaveLength(0);
    expect(addLinesForUnlistedWavs()).toBe(2);
    await expect(save()).resolves.toBeTruthy();
    expect(new TextDecoder().decode(folder.files.get("oto.ini"))).toContain(
      "a.wav="
    );
  });

  it("iniの個別選択をキャンセルしたら現在の編集内容を維持する", async () => {
    const { folder, platform } = fixture();
    await openVoiceFolder(folder, platform);
    updateAlias(firstLine().id, "未保存");
    const before = editorStore.state.workspace;
    vi.spyOn(folder, "stat").mockRejectedValueOnce(
      new FileAccessError("permission", "Name is not allowed")
    );
    const selectedFolder: VoiceFolder = {
      name: folder.name,
      listFiles: folder.listFiles.bind(folder),
      stat: folder.stat.bind(folder),
      read: folder.read.bind(folder),
      write: folder.write.bind(folder),
      ensureWritable: folder.ensureWritable.bind(folder),
      pickIni: async () => await Promise.resolve(null),
    };
    const opening = openVoiceFolder(selectedFolder, platform);
    await vi.waitFor(() => {
      expect(editorStore.state.dialog).not.toBeNull();
    });
    editorStore.state.dialog?.resolve("select");
    await expect(opening).rejects.toMatchObject({ kind: "cancelled" });
    expect(editorStore.state.workspace).toBe(before);
    expect(folder.files.get("oto.ini")).toStrictEqual(SOURCE);
  });

  it("同じ選択・設定・文字コードでは参照も履歴も変えない", async () => {
    const { folder, platform } = fixture();
    await openVoiceFolder(folder, platform);
    const line = firstLine();
    const before = editorStore.state;
    select(line.id);
    updateParams(line.id, { offset: line.parsed.oto.offset });
    updateAlias(line.id, line.parsed.oto.alias);
    setEncoding(opened().history.present.otoSet.encoding);
    expect(editorStore.state).toBe(before);
    expect(opened().history.past).toHaveLength(0);
    expect(firstLine()).toBe(line);
  });

  it("行の変更と元に戻す／やり直すで未変更行の参照を維持する", async () => {
    const { folder, platform } = fixture();
    await openVoiceFolder(folder, platform);
    const before = opened().history.present.otoSet;
    const line = firstLine();
    updateParams(line.id, { preutter: 25 });
    const edited = opened().history.present.otoSet;
    expect(edited.lines[1]).toBe(before.lines[1]);
    undo();
    expect(opened().history.present.otoSet).toBe(before);
    redo();
    expect(opened().history.present.otoSet).toBe(edited);
    undo();
    updateAlias(line.id, "new");
    const replaced = opened().history.present.otoSet;
    redo();
    expect(opened().history.present.otoSet).toBe(replaced);
    expect(opened().history.future).toHaveLength(0);
  });

  it("最後の行を削除しても編集状態を保ち、新規行を選べる", async () => {
    const { folder, platform } = fixture();
    folder.files.delete("oto.ini");
    await openVoiceFolder(folder, platform);
    addLine("a.wav");
    deleteLine(firstLine().id);
    expect(opened().history.present.selectedId).toBeNull();
    expect(opened().history.present.otoSet.lines).toHaveLength(0);
    addLine("b.wav");
    expect(opened().history.present.selectedId).toBe(firstLine().id);
  });

  it("画面からの削除は同じWAVの最後の行を残し、複製した行なら消せる", async () => {
    const { folder, platform } = fixture();
    await openVoiceFolder(folder, platform);
    const first = firstLine();
    deleteLineKeepingWav(first.id);
    expect(opened().history.present.otoSet.lines).toHaveLength(2);
    expect(editorStore.state.notice?.tone).toBe("warning");
    duplicateLine(first.id);
    deleteLineKeepingWav(first.id);
    expect(
      opened().history.present.otoSet.lines.map((line) => line.text)
    ).toStrictEqual(["a.wav=a,1.000,2,-30,4,5", "b.wav=b,1,2,3,4,5"]);
  });

  it("未登録WAVがなければ行オブジェクトを作らず、履歴を積まない", async () => {
    const { folder, platform } = fixture();
    await openVoiceFolder(folder, platform);
    const before = editorStore.state;
    expect(addLinesForUnlistedWavs()).toBe(0);
    expect(editorStore.state).toBe(before);
  });

  it("復元用の記録は元ファイルを変えず、明示保存でバックアップと照合を行う", async () => {
    const { folder, platform, records } = fixture();
    await openVoiceFolder(folder, platform);
    updateAlias(firstLine().id, "a2");
    await writeRecovery();
    expect(records.size).toBe(1);
    expect(folder.files.get("oto.ini")).toBe(SOURCE);
    await expect(save()).resolves.toBeTruthy();
    expect(folder.files.get("oto.ini.bak")).toBe(SOURCE);
    expect({
      dirty: selectIsDirty(editorStore.state),
      records: records.size,
    }).toStrictEqual({ dirty: false, records: 0 });
  });

  it.each(["oto.ini", "oto.ini.bak"])(
    "%sの書き込み失敗では変更を失わない",
    async (target) => {
      const { folder, platform } = fixture();
      await openVoiceFolder(folder, platform);
      updateAlias(firstLine().id, "a2");
      const edited = opened().history.present.otoSet;
      folder.failedWrites.add(target);
      await expect(save()).resolves.toBeFalsy();
      expect(selectIsDirty(editorStore.state)).toBeTruthy();
      expect(opened().history.present.otoSet).toBe(edited);
      expect(folder.files.get("oto.ini")).toBe(SOURCE);
    }
  );

  it("保存権限を拒否されても未保存のまま保持する", async () => {
    const { folder, platform } = fixture();
    await openVoiceFolder(folder, platform);
    updateAlias(firstLine().id, "a2");
    folder.writable = false;
    await expect(save()).resolves.toBeFalsy();
    expect(selectIsDirty(editorStore.state)).toBeTruthy();
    expect(folder.files.get("oto.ini")).toBe(SOURCE);
  });

  it("外部変更で上書きをキャンセルすると元ファイルと編集を保持する", async () => {
    const { folder, platform } = fixture();
    await openVoiceFolder(folder, platform);
    updateAlias(firstLine().id, "a2");
    const external = new TextEncoder().encode("a.wav=external,1,2,3,4,5");
    folder.files.set("oto.ini", external);
    const saving = save();
    await vi.waitFor(() => {
      expect(editorStore.state.dialog).not.toBeNull();
    });
    editorStore.state.dialog?.resolve("cancel");
    await expect(saving).resolves.toBeFalsy();
    expect(folder.files.get("oto.ini")).toBe(external);
    expect(selectIsDirty(editorStore.state)).toBeTruthy();
  });

  it("保存中の追加編集を保存済み扱いにしない", async () => {
    const { folder, platform } = fixture();
    await openVoiceFolder(folder, platform);
    const line = firstLine();
    updateAlias(line.id, "a2");
    const saving = save();
    updateAlias(line.id, "a3");
    await expect(saving).resolves.toBeTruthy();
    expect(new TextDecoder().decode(folder.files.get("oto.ini"))).toContain(
      "a.wav=a2,"
    );
    expect(firstLine().parsed.oto.alias).toBe("a3");
    expect(selectIsDirty(editorStore.state)).toBeTruthy();
  });

  it("範囲の貼り付けは一回の「元に戻す」で全行を戻す", async () => {
    const { folder, platform } = fixture();
    await openVoiceFolder(folder, platform);
    const source = opened().history.present.otoSet;
    const cells = source.lines
      .filter(isOtoLine)
      .map((line) => ({ lineId: line.id, column: "preutter" as const }));
    transformOtoSet((otoSet) => pasteCells(otoSet, cells, "25\n"));
    expect(
      opened()
        .history.present.otoSet.lines.filter(isOtoLine)
        .map((line) => line.parsed.oto.preutter)
    ).toStrictEqual([25, 25]);
    undo();
    expect(opened().history.present.otoSet).toBe(source);
    redo();
    expect(firstLine().parsed.oto.preutter).toBe(25);
  });

  it("別名保存は元iniを保持し、以後の保存先と復元名を切り替える", async () => {
    const { folder, platform, records } = fixture();
    await openVoiceFolder(folder, platform);
    updateAlias(firstLine().id, "a2");
    await expect(saveAs("custom.ini")).resolves.toBeTruthy();
    expect(folder.files.get("oto.ini")).toBe(SOURCE);
    expect(new TextDecoder().decode(folder.files.get("custom.ini"))).toContain(
      "a.wav=a2,"
    );
    expect(opened().session.otoName).toBe("custom.ini");
    updateAlias(firstLine().id, "a3");
    await writeRecovery();
    expect(records.get("fixture")?.data.otoName).toBe("custom.ini");
  });

  it("別名保存失敗時は元の保存先と未保存編集を保持する", async () => {
    const { folder, platform } = fixture();
    await openVoiceFolder(folder, platform);
    updateAlias(firstLine().id, "a2");
    folder.failedWrites.add("custom.ini");
    await expect(saveAs("custom.ini")).resolves.toBeFalsy();
    expect(opened().session.otoName).toBe("oto.ini");
    expect(selectIsDirty(editorStore.state)).toBeTruthy();
    expect(firstLine().parsed.oto.alias).toBe("a2");
  });

  it("同じファイル名の別フォルダの長さを混ぜず、一覧は元の行を参照する", async () => {
    const { folder, platform } = fixture();
    const other = fixture().folder;
    const session = await openVoiceFolder(folder, platform);
    const line = firstLine();
    setDuration(folder, "a.wav", 10);
    setDuration(other, "a.wav", 1000);
    const own = durationStore.state.get(folder) ?? EMPTY_DURATIONS;
    const foreign = durationStore.state.get(other) ?? EMPTY_DURATIONS;
    const rows = buildRows(session.savedOtoSet, session.wavs, own);
    expect(rows[0]?.line).toBe(line);
    expect(buildRows(session.savedOtoSet, session.wavs, own)[0]).toBe(rows[0]);
    expect(
      rows[0]?.statuses.some(
        (status) => status.text === "右ブランクが原音の長さを超えています"
      )
    ).toBeTruthy();
    expect(
      buildRows(session.savedOtoSet, session.wavs, foreign)[0]?.statuses.some(
        (status) => status.text === "右ブランクが原音の長さを超えています"
      )
    ).toBeFalsy();
  });

  it("別フォルダへの保存後もWAVの読み込み元を保持し、通常保存と復元名を切り替える", async () => {
    const { folder, platform, records } = fixture();
    const destination = new MemoryFolder();
    destination.files.clear();
    await openVoiceFolder(folder, platform);
    updateAlias(firstLine().id, "outside");
    await expect(saveAs("copy.ini", destination)).resolves.toBeTruthy();
    expect([
      opened().session.folder,
      opened().session.storageFolder,
    ]).toStrictEqual([folder, destination]);
    expect(folder.files.get("oto.ini")).toBe(SOURCE);
    updateAlias(firstLine().id, "outside2");
    await save();
    updateAlias(firstLine().id, "pending");
    await writeRecovery();
    expect(
      new TextDecoder().decode(destination.files.get("copy.ini"))
    ).toContain("a.wav=outside2,");
    expect(records.get("fixture")?.data.storageBookmark?.name).toBe(
      destination.name
    );
  });

  it("コメントのみの編集も未保存として保存・復元し、iniの原本を保持する", async () => {
    const { folder, platform, records } = fixture();
    await openVoiceFolder(folder, platform);
    transformOtoSet((set) => ({
      ...set,
      lines: set.lines.map((line, i) =>
        i === 0 ? { ...line, comment: "確認済み" } : line
      ),
    }));
    await writeRecovery();
    expect(records.get("fixture")?.data.otoSet.lines[0]?.comment).toBe(
      "確認済み"
    );
    await expect(save()).resolves.toBeTruthy();
    expect(folder.files.get("oto.ini")).toStrictEqual(SOURCE);
    expect(
      new TextDecoder("shift_jis").decode(folder.files.get("oto-comment.txt"))
    ).toBe("確認済み\r\n\r\n");
    expect(selectIsDirty(editorStore.state)).toBeFalsy();
  });

  it("WAVカットで同じ音声を使う全行を移し、他の音声は保持する", async () => {
    const { folder, platform } = fixture();
    const wav = encodePcmWave({
      rate: 1000,
      channels: [new Float32Array(2000)],
      bits: 16,
      floating: false,
    });
    folder.files.set("a.wav", wav);
    folder.files.set(
      "oto.ini",
      new TextEncoder().encode(
        "a.wav=a,200,300,-1200,150,50\na.wav=a2,400,300,100,150,50\nb.wav=b,10,20,30,40,50\n"
      )
    );
    await openVoiceFolder(folder, platform);
    const pending = processWavs(["a.wav"], {
      dc: false,
      mono: false,
      headMs: 100,
      tailMs: 200,
    });
    editorStore.state.dialog?.resolve("run");
    await pending;
    const offsets = opened().history.present.otoSet.lines.flatMap((line) =>
      line.parsed.kind === "oto" ? [line.parsed.oto.offset] : []
    );
    expect(offsets).toStrictEqual([100, 300, 10]);
    expect(decodePcmWave(await folder.read("a.wav")).channels[0]).toHaveLength(
      1700
    );
    expect(folder.files.get("a.wav.bak")).toBe(wav);
    expect(selectIsDirty(editorStore.state)).toBeFalsy();
  });

  it("WAV名の変更は関連ファイルと全参照を更新し、バックアップを残す", async () => {
    const { folder, platform } = fixture();
    const frequency = new Uint8Array([1, 2]);
    folder.files.set("a_wav.frq", frequency);
    await openVoiceFolder(folder, platform);
    const pending = renameWavs(true);
    editorStore.state.dialog?.resolve("run");
    await pending;
    expect(folder.files.has("a.wav")).toBeFalsy();
    expect(folder.files.has("_a.wav")).toBeTruthy();
    expect(folder.files.get("_a_wav.frq")).toBe(frequency);
    expect(firstLine().parsed.oto.wav).toBe("_a.wav");
    expect(folder.files.get("oto.ini.bak")).toBe(SOURCE);
  });
});
