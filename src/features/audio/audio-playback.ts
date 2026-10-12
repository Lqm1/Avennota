export class AudioPlayback {
  private readonly options: AudioContextOptions;
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private request = 0;
  private pending = false;

  constructor(options: AudioContextOptions = {}) {
    this.options = options;
  }

  get active(): boolean {
    return this.source !== null || this.pending;
  }

  begin(): number {
    this.stop();
    this.pending = true;
    return this.request;
  }

  isCurrent(token: number): boolean {
    return token === this.request;
  }

  async audioContext(): Promise<AudioContext> {
    this.context ??= new AudioContext(this.options);
    await this.context.resume();
    return this.context;
  }

  start(
    token: number,
    buffer: AudioBuffer,
    range?: { offset: number; duration: number },
    onEnded?: () => void
  ): void {
    if (!this.isCurrent(token) || this.context === null) {
      return;
    }
    this.pending = false;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.addEventListener(
      "ended",
      () => {
        if (this.source === source) {
          this.source = null;
          onEnded?.();
        }
        source.disconnect();
      },
      { once: true }
    );
    this.source = source;
    source.start(0, range?.offset ?? 0, range?.duration);
  }

  finish(token: number): void {
    if (this.isCurrent(token)) {
      this.pending = false;
    }
  }

  stop(): void {
    this.request += 1;
    this.pending = false;
    this.source?.stop();
    this.source = null;
  }
}
