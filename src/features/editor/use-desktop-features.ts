import { isTauri, invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

import { getFilePlatform } from "../../platform/files";
import { parseOto } from "../oto/oto-set";
import { loadFolderHistory } from "./folder-history";
import { useSettings } from "./settings";
import {
  confirmDiscardChanges,
  editorStore,
  notify,
  openVoiceFolder,
  runTool,
  transformOtoSet,
} from "./store";

const configureWindow = async (topmost: boolean, opacity: number) => {
  if (isTauri()) {
    await runTool(async () => {
      await invoke("configure_window", { topmost, opacity });
    });
  }
};
const prevent = (event: DragEvent) => {
  if (event.dataTransfer?.types.includes("Files") === true) {
    event.preventDefault();
  }
};

const drop = (event: DragEvent) => {
  if (event.dataTransfer === null) {
    return;
  }
  event.preventDefault();
  const [item] = event.dataTransfer.items;
  // ハンドル取得はドロップのユーザー操作が有効な間に開始する。
  const handlePromise = item?.getAsFileSystemHandle?.();
  const [file] = event.dataTransfer.files;
  const run = async () => {
    const handle = await handlePromise;
    if (handle instanceof FileSystemDirectoryHandle) {
      if (!(await confirmDiscardChanges("ドロップしたフォルダを開く"))) {
        return;
      }
      const { createBrowserFolder } =
        await import("../../platform/files/browser");
      await openVoiceFolder(
        createBrowserFolder(handle),
        await getFilePlatform()
      );
    } else if (file?.name.toLowerCase().endsWith(".ini") === true) {
      if (editorStore.state.workspace.kind === "closed") {
        notify("warning", "WAVのあるフォルダを先に開いてください。");
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!(await confirmDiscardChanges("ドロップしたiniを読み込む"))) {
        return;
      }
      transformOtoSet(() => parseOto(bytes));
      notify(
        "info",
        "ドロップしたiniを現在の音源フォルダへ読み込みました。保存先は現在のiniです。"
      );
    } else {
      notify(
        "warning",
        "音源フォルダまたはiniファイルをドロップしてください。"
      );
    }
  };
  void runTool(run);
};
const registerDrops = () => {
  void runTool(loadFolderHistory);
  let disposed = false;
  let stop: (() => void) | null = null;
  const native = async () => {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    const off = await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") {
        return;
      }
      const [path] = event.payload.paths;
      if (path === undefined) {
        return;
      }
      const run = async () => {
        if (!(await confirmDiscardChanges("ドロップしたフォルダを開く"))) {
          return;
        }
        const { stat } = await import("@tauri-apps/plugin-fs");
        const { dirname, basename } = await import("@tauri-apps/api/path");
        const { createNativeFolder } =
          await import("../../platform/files/tauri");
        const info = await stat(path);
        await openVoiceFolder(
          createNativeFolder(info.isDirectory ? path : await dirname(path)),
          await getFilePlatform(),
          !info.isDirectory && path.toLowerCase().endsWith(".ini")
            ? await basename(path)
            : undefined
        );
      };
      void runTool(run);
    });
    if (disposed) {
      off();
    } else {
      stop = off;
    }
  };
  if (isTauri()) {
    void runTool(native);
  } else {
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", drop);
  }
  return () => {
    disposed = true;
    stop?.();
    window.removeEventListener("dragover", prevent);
    window.removeEventListener("drop", drop);
  };
};
export const useDesktopFeatures = (): void => {
  const settings = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--font-sans", settings.advanced.fontFamily);
    root.style.fontSize = `${(16 * settings.advanced.fontSize) / 12}px`;
    for (const [key, value] of Object.entries(settings.advanced.colors)) {
      root.style.setProperty(`--color-${key}`, value);
    }
    void configureWindow(
      settings.advanced.alwaysOnTop,
      settings.advanced.opacity
    );
  }, [settings.advanced]);
  useEffect(registerDrops, []);
};
