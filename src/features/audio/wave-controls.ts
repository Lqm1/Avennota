import type { Marker } from "../oto/geometry";

export interface WaveControls {
  playAll: () => void;
  /** 左ブランクから右ブランクまでを再生する。 */
  playRange: () => void;
  playPreset: (index: number) => void;
  playVisible: () => void;
  stop: () => void;
  zoom: (factor: number) => void;
  fit: () => void;
  /** 表示幅に対する割合で横に動かす。 */
  scroll: (pages: number) => void;
  scrollToStart: () => void;
  /** ポインター位置（なければ再生カーソル位置）へマーカーを置く。 */
  placeMarker: (marker: Marker) => void;
  beginMarker: (marker: Marker, alt: boolean) => void;
  endMarker: () => void;
  reload: () => void;
  amplify: (factor: number) => void;
}

let current: WaveControls | null = null;

export const registerWaveControls = (controls: WaveControls): (() => void) => {
  current = controls;
  return () => {
    if (current === controls) {
      current = null;
    }
  };
};

export const waveControls = (): WaveControls | null => current;
