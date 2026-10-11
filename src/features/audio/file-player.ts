let context: AudioContext | null = null;
let player: AudioBufferSourceNode | null = null;
let request = 0;
let pending = false;
export const isFilePlaying = () => player !== null || pending;
export const stopFilePlayback = () => {
  request += 1;
  pending = false;
  player?.stop();
  player = null;
};
export const playFileRange = async (
  blob: Blob,
  startMs: number,
  endMs: number,
  onFinish?: () => void
): Promise<void> => {
  stopFilePlayback();
  pending = true;
  const token = request;
  try {
    context ??= new AudioContext();
    await context.resume();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (token !== request) {
      return;
    }
    const start = Math.max(0, Math.min(buffer.duration, startMs / 1000));
    const end = Math.max(start, Math.min(buffer.duration, endMs / 1000));
    if (end <= start) {
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    player = source;
    source.addEventListener(
      "ended",
      () => {
        if (player === source) {
          player = null;
          onFinish?.();
        }
        source.disconnect();
      },
      { once: true }
    );
    source.start(0, start, end - start);
  } finally {
    if (token === request) {
      pending = false;
    }
  }
};
