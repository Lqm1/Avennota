/* eslint-disable no-await-in-loop -- 音源全体を同時デコードせず、WAVごとにメモリを解放する。 */
import { loadWavBlob, durationStore, setDuration } from "../audio/wav-cache";
import { cutoffInMode } from "../oto/marker-movement";
import { settingsStore, updateSettings } from "./settings";
import type { EditorSettings } from "./settings";
import { editorStore, notify, updateManyParams } from "./store";

/** 表現切り替えは終端を維持して全行へ適用する。読めないWAVがあれば変更しない。 */
export const applyEditorSettings = async (
  next: EditorSettings
): Promise<boolean> => {
  const { workspace } = editorStore.state;
  if (
    workspace.kind === "open" &&
    next.cutoffMode !== settingsStore.state.cutoffMode
  ) {
    let context: AudioContext | null = null;
    try {
      const changes = new Map<string, { cutoff: number }>();
      const durations = new Map(
        durationStore.state.get(workspace.session.folder)
      );
      for (const line of workspace.history.present.otoSet.lines) {
        if (line.parsed.kind !== "oto") {
          continue;
        }
        const { oto } = line.parsed;
        const key = oto.wav.toLowerCase();
        let duration = durations.get(key);
        if (duration === undefined) {
          const name = workspace.session.wavs.get(key);
          if (name === undefined) {
            throw new Error(`${oto.wav}がありません`);
          }
          context ??= new AudioContext();
          const blob = await loadWavBlob(workspace.session.folder, name);
          const audio = await context.decodeAudioData(await blob.arrayBuffer());
          duration = audio.duration * 1000;
          durations.set(key, duration);
          setDuration(workspace.session.folder, name, duration);
        }
        changes.set(line.id, {
          cutoff: cutoffInMode(oto, duration, next.cutoffMode),
        });
      }
      if (editorStore.state.workspace !== workspace) {
        throw new Error("変換中に編集対象が変更されました");
      }
      updateManyParams(changes);
    } catch (error) {
      notify("error", `右ブランクを変換できません: ${String(error)}`);
      return false;
    } finally {
      await context?.close();
    }
  }
  updateSettings(next);
  return true;
};
