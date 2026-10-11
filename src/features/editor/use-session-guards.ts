import { useDebouncedCallback } from "@tanstack/react-pacer";
import { useEffect } from "react";

import { guardWindowClose } from "../../platform/window";
import {
  confirmDiscardChanges,
  editorStore,
  selectIsDirty,
  writeRecovery,
} from "./store";

/**
 * 未保存の編集を守る。編集が止まって1秒後に復元データを記録し、終了時は保存・破棄・キャンセルを選ばせる。
 * ブラウザでは標準の確認だけを出し、内容は復元データに残す。
 */
export const useSessionGuards = (): void => {
  const record = useDebouncedCallback(writeRecovery, { wait: 1000 });

  useEffect(() => {
    let previous = editorStore.state.workspace;
    const subscription = editorStore.subscribe(({ workspace }) => {
      if (
        workspace.kind === "open" &&
        (previous.kind === "closed" ||
          workspace.history.present.otoSet !==
            previous.history.present.otoSet ||
          workspace.session.savedOtoSet !== previous.session.savedOtoSet)
      ) {
        record();
      }
      previous = workspace;
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [record]);

  useEffect(
    () =>
      guardWindowClose({
        canClose: async () => await confirmDiscardChanges("終了する"),
        hasUnsavedChanges: () => selectIsDirty(editorStore.state),
      }),
    []
  );
};
