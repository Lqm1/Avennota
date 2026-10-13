import { Check } from "../../components/ui/check";
import { SelectField } from "../../components/ui/field";
import type { EditorSettings } from "./settings";

export const InputSettingsFields = ({
  draft,
  onChange,
}: {
  draft: EditorSettings;
  onChange: (patch: Partial<EditorSettings>) => void;
}) => (
  <div className="flex flex-col gap-3">
    <SelectField
      label="左ブランクドラッグ時の動作"
      value={draft.offsetMode}
      options={[
        { id: "positions", label: "左ブランクのみ移動" },
        { id: "relative", label: "他のマーカーも連動して移動" },
      ]}
      onChange={(offsetMode) => {
        onChange({ offsetMode });
      }}
    />
    <SelectField
      label="先行発声ドラッグ時の動作"
      value={draft.preutterMode}
      options={[
        { id: "independent", label: "先行発声のみ移動" },
        { id: "relative", label: "他のマーカーも連動して移動" },
      ]}
      onChange={(preutterMode) => {
        onChange({ preutterMode });
      }}
    />
    <SelectField
      label="波形・スペクトログラムのクリック動作"
      value={draft.clickMode}
      options={[
        { id: "none", label: "何もしない" },
        { id: "range", label: "境界線間をクリックして再生" },
        { id: "timing", label: "発声タイミング補正" },
      ]}
      onChange={(clickMode) => {
        onChange({ clickMode });
      }}
    />
    <SelectField
      label="右ブランクの数値表現"
      value={draft.cutoffMode}
      options={[
        { id: "positive", label: "WAV末尾からの距離（正の値）" },
        { id: "negative", label: "左ブランクからの長さ（負の値）" },
      ]}
      onChange={(cutoffMode) => {
        onChange({ cutoffMode });
      }}
    />
    <Check
      label="オーバーラップの負の値を許可"
      value={draft.negativeOverlap}
      onChange={(negativeOverlap) => {
        onChange({ negativeOverlap });
      }}
    />
    <Check
      label="左右ブランクの移動時に内側マーカーを押し出す（ほうきモード）"
      value={draft.blankBroom}
      onChange={(blankBroom) => {
        onChange({ blankBroom });
      }}
    />
    <Check
      label="F9キーでの波形トリミングを有効化（左右ブランクの外側を削除）"
      value={draft.advanced.allowTrim}
      onChange={(allowTrim) => {
        onChange({ advanced: { ...draft.advanced, allowTrim } });
      }}
    />
    <Check
      label="再生位置に合わせて自動スクロール"
      value={draft.followPlayMark}
      onChange={(followPlayMark) => {
        onChange({ followPlayMark });
      }}
    />
    <Check
      label="再生終了後に元のスクロール位置へ戻る"
      value={draft.returnToPlayStart}
      onChange={(returnToPlayStart) => {
        onChange({ returnToPlayStart });
      }}
    />
  </div>
);
