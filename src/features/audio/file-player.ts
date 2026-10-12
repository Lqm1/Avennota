import { AudioPlayback } from "./audio-playback";

export const filePlayback = new AudioPlayback();

export const playFileRange = async (
  blob: Blob,
  startMs: number,
  endMs: number,
  onFinish?: () => void
): Promise<void> => {
  const token = filePlayback.begin();
  try {
    const context = await filePlayback.audioContext();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const start = Math.max(0, Math.min(buffer.duration, startMs / 1000));
    const end = Math.max(start, Math.min(buffer.duration, endMs / 1000));
    if (end > start) {
      filePlayback.start(
        token,
        buffer,
        { offset: start, duration: end - start },
        onFinish
      );
    }
  } finally {
    filePlayback.finish(token);
  }
};
