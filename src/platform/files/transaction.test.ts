import { describe, expect, it } from "vitest";

import { applyFileChanges } from "./transaction";
import type { VoiceFolder } from "./types";

const encode = (value: string) => new TextEncoder().encode(value);
class TransactionFolder implements VoiceFolder {
  readonly name = "transaction";
  readonly files = new Map<string, Uint8Array<ArrayBuffer>>();
  readonly writes: string[] = [];
  writable = true;
  fail = "";
  async ensureWritable() {
    return await Promise.resolve(this.writable);
  }
  async listFiles() {
    return await Promise.resolve([...this.files.keys()]);
  }
  async stat(name: string) {
    const bytes = this.files.get(name);
    return await Promise.resolve(
      bytes === undefined ? null : { size: bytes.length, modifiedAt: 0 }
    );
  }
  async read(name: string) {
    const bytes = this.files.get(name);
    if (bytes === undefined) {
      throw new Error("missing");
    }
    return await Promise.resolve(bytes);
  }
  async write(name: string, bytes: Uint8Array<ArrayBuffer>) {
    this.writes.push(name);
    if (name === this.fail) {
      this.fail = "";
      throw new Error("planned failure");
    }
    this.files.set(name, bytes);
    await Promise.resolve();
  }
  async remove(name: string) {
    this.files.delete(name);
    await Promise.resolve();
  }
}
describe("複数ファイルの保存", () => {
  it("全バックアップの完了前には元ファイルを書き換えない", async () => {
    const folder = new TransactionFolder();
    const a = encode("a");
    const b = encode("b");
    folder.files.set("a.wav", a);
    folder.files.set("oto.ini", b);
    folder.fail = "oto.ini.bak";
    await expect(
      applyFileChanges(folder, [
        { name: "a.wav", before: a, after: encode("new a") },
        { name: "oto.ini", before: b, after: encode("new b") },
      ])
    ).rejects.toThrow("planned failure");
    expect(folder.files.get("a.wav")).toBe(a);
    expect(folder.files.get("oto.ini")).toBe(b);
    expect(folder.writes).toStrictEqual(["a.wav.bak", "oto.ini.bak"]);
  });

  it("書き込み途中の失敗でWAVと新規ファイルを戻し、バックアップは保持する", async () => {
    const folder = new TransactionFolder();
    const original = encode("original");
    folder.files.set("a.wav", original);
    folder.fail = "oto.ini";
    await expect(
      applyFileChanges(folder, [
        { name: "new.wav", before: null, after: original },
        { name: "a.wav", before: original, after: encode("changed") },
        { name: "oto.ini", before: null, after: encode("ini") },
      ])
    ).rejects.toThrow("planned failure");
    expect(folder.files.has("new.wav")).toBeFalsy();
    expect(folder.files.get("a.wav")).toBe(original);
    expect(folder.files.get("a.wav.bak")).toBe(original);
  });

  it("WAVと別フォルダのiniを一組として保存し、同じ名前の音源側iniを維持する", async () => {
    const voice = new TransactionFolder();
    const target = new TransactionFolder();
    const wav = encode("wav");
    const sourceIni = encode("source");
    const destinationIni = encode("destination");
    voice.files.set("a.wav", wav);
    voice.files.set("oto.ini", sourceIni);
    target.files.set("oto.ini", destinationIni);
    await applyFileChanges(voice, [
      { name: "a.wav", before: wav, after: encode("updated wav") },
      {
        folder: target,
        name: "oto.ini",
        before: destinationIni,
        after: encode("updated ini"),
      },
    ]);
    expect(voice.files.get("oto.ini")).toBe(sourceIni);
    expect(target.files.get("oto.ini.bak")).toBe(destinationIni);
    expect(new TextDecoder().decode(target.files.get("oto.ini"))).toBe(
      "updated ini"
    );
  });

  it("外部変更をすべて検出してから保存を中止する", async () => {
    const folder = new TransactionFolder();
    folder.files.set("oto.ini", encode("external"));
    await expect(
      applyFileChanges(folder, [
        { name: "new.wav", before: null, after: encode("new") },
        {
          name: "oto.ini",
          before: encode("original"),
          after: encode("changed"),
        },
      ])
    ).rejects.toThrow("変更されています");
    expect(folder.writes).toHaveLength(0);
  });
});
