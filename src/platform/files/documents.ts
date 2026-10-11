import { isTauri, invoke } from "@tauri-apps/api/core";

export interface DocumentBytes {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}
export const pickDocument = async (
  extensions: string[]
): Promise<DocumentBytes | null> => {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const path = await open({
      multiple: false,
      filters: [{ name: "ファイル", extensions }],
    });
    return typeof path === "string"
      ? {
          name: path.split(/[\\/]/u).at(-1) ?? path,
          bytes: await readFile(path),
        }
      : null;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "ファイル",
          accept: {
            "application/octet-stream": extensions.map(
              (ext): `.${string}` => `.${ext}`
            ),
          },
        },
      ],
    });
    if (handle === undefined) {
      return null;
    }
    const file = await handle.getFile();
    return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    throw error;
  }
};
export const exportDocument = async (
  name: string,
  bytes: Uint8Array<ArrayBuffer>
): Promise<boolean> => {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name });
    if (path === null) {
      return false;
    }
    await invoke("write_document", { path, bytes: [...bytes] });
    return true;
  }
  try {
    const handle = await window.showSaveFilePicker({ suggestedName: name });
    const writable = await handle.createWritable();
    try {
      await writable.write(bytes);
      await writable.close();
    } catch (error) {
      await writable.abort();
      throw error;
    }
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return false;
    }
    throw error;
  }
};
