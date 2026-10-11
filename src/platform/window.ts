import { isTauri } from "@tauri-apps/api/core";

const listenNativeClose = async (
  canClose: () => Promise<boolean>,
  isDisposed: () => boolean
): Promise<(() => void) | null> => {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const stop = await getCurrentWindow().onCloseRequested(async (event) => {
    if (!(await canClose())) {
      event.preventDefault();
    }
  });
  if (isDisposed()) {
    stop();
    return null;
  }
  return stop;
};

const stopWhenRegistered = async (
  registration: Promise<(() => void) | null>
): Promise<void> => {
  try {
    const stop = await registration;
    stop?.();
  } catch {
    // 登録に失敗していれば、解除するものはない。
  }
};

/**
 * アプリを閉じる前に確認する。ネイティブ版は独自の確認（保存・破棄・キャンセル）を出せるが、
 * ブラウザは標準の確認しか出せないため、未保存かどうかだけを渡す。戻り値は登録の解除。
 */
export const guardWindowClose = (options: {
  canClose: () => Promise<boolean>;
  hasUnsavedChanges: () => boolean;
}): (() => void) => {
  if (isTauri()) {
    let disposed = false;
    const registration = listenNativeClose(options.canClose, () => disposed);
    return () => {
      disposed = true;
      void stopWhenRegistered(registration);
    };
  }
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (options.hasUnsavedChanges()) {
      event.preventDefault();
    }
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    window.removeEventListener("beforeunload", onBeforeUnload);
  };
};
