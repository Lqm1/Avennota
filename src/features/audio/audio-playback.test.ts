import { describe, expect, it } from "vitest";

import { AudioPlayback } from "./audio-playback";

describe("再生の依頼", () => {
  it("新しい依頼は前の依頼を無効にし、最後の依頼が終わるまで再生中とみなす", () => {
    const playback = new AudioPlayback();
    const first = playback.begin();
    const second = playback.begin();
    expect(playback.isCurrent(first)).toBeFalsy();
    playback.finish(first);
    expect(playback.active).toBeTruthy();
    playback.finish(second);
    expect(playback.active).toBeFalsy();
  });

  it("停止すると依頼中の処理を無効にする", () => {
    const playback = new AudioPlayback();
    const token = playback.begin();
    playback.stop();
    expect(playback.isCurrent(token)).toBeFalsy();
    expect(playback.active).toBeFalsy();
  });
});
