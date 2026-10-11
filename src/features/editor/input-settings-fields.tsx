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
      label="左ブランクを動かしたとき"
      value={draft.offsetMode}
      options={[
        { id: "positions", label: "左ブランクのみを動かす" },
        { id: "relative", label: "他パラメータも動かして相対位置を保つ" },
      ]}
      onChange={(offsetMode) => {
        onChange({ offsetMode });
      }}
    />
    <SelectField
      label="先行発声を動かしたとき"
      value={draft.preutterMode}
      options={[
        { id: "independent", label: "先行発声のみを動かす" },
        { id: "relative", label: "他パラメータも動かして相対位置を保つ" },
      ]}
      onChange={(preutterMode) => {
        onChange({ preutterMode });
      }}
    />
    <SelectField
      label="波形・スペクトログラムのクリック操作"
      value={draft.clickMode}
      options={[
        { id: "none", label: "再生しない" },
        { id: "range", label: "近傍パラメータ間を再生する" },
        { id: "timing", label: "発声タイミング補正" },
      ]}
      onChange={(clickMode) => {
        onChange({ clickMode });
      }}
    />
    <SelectField
      label="右ブランク値の表現方法"
      value={draft.cutoffMode}
      options={[
        { id: "positive", label: "ファイル末尾からの時間（正の値）" },
        { id: "negative", label: "左ブランクからの時間（負の値）" },
      ]}
      onChange={(cutoffMode) => {
        onChange({ cutoffMode });
      }}
    />
    <Check
      label="オーバーラップを負にしても良い"
      value={draft.negativeOverlap}
      onChange={(negativeOverlap) => {
        onChange({ negativeOverlap });
      }}
    />
    <Check
      label="左右ブランクの移動可能範囲を他パラメータより優先する"
      value={draft.blankBroom}
      onChange={(blankBroom) => {
        onChange({ blankBroom });
      }}
    />
    <Check
      label="F9で左右ブランクの両側波形をカットする"
      value={draft.advanced.allowTrim}
      onChange={(allowTrim) => {
        onChange({ advanced: { ...draft.advanced, allowTrim } });
      }}
    />
    <Check
      label="再生位置に追随して画面をスクロールさせる"
      value={draft.followPlayMark}
      onChange={(followPlayMark) => {
        onChange({ followPlayMark });
      }}
    />
    <Check
      label="再生後に元の描画位置に戻る"
      value={draft.returnToPlayStart}
      onChange={(returnToPlayStart) => {
        onChange({ returnToPlayStart });
      }}
    />
  </div>
);
