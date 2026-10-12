export interface AcousticModel {
  id: string;
  name: string;
  parameters: ArrayBuffer;
  phonemap: string;
}

/** 音素の開始・終了は原音の先頭からの秒数。 */
export interface PhoneInterval {
  name: string;
  start: number;
  end: number;
}

export interface AlignmentResult {
  duration: number;
  intervals: PhoneInterval[];
}

/** CVの設定に使う音の立ち上がり。時刻は原音先頭からの秒数。 */
export interface CvOnset {
  speechStart: number;
  voicingStart: number;
}
