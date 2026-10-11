import { releaseProxy, transfer, wrap } from "comlink";
import { useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";

import type { AudioAnalysisWorker } from "../../workers/audio-analysis";
import type { AdvancedSettings } from "../editor/advanced-settings";
import { frequencyNote, NOTE_NAMES } from "../editor/pitch-settings";
import { notify } from "../editor/store";
import { MARKER_LABELS, MARKERS, toPositions } from "../oto/geometry";
import type { OtoParams } from "../oto/oto-set";
import type { AudioAnalysis } from "./analysis";

const updateMarkerHit = (
  layer: HTMLDivElement | null,
  marker: string,
  px: number,
  width: number
) => {
  const hit = layer?.querySelector<HTMLElement>(`[data-marker="${marker}"]`);
  if (hit) {
    hit.style.left = `${px - 7}px`;
    hit.style.display = px >= 0 && px <= width ? "block" : "none";
  }
};
const noteName = (hz: number) => {
  const midi = frequencyNote(hz);
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
};
export const AnalysisPanels = ({
  instance,
  options,
  top,
  params,
  durationMs,
  offsetMs,
  powerHeight,
  pitchHeight,
}: {
  instance: WaveSurfer;
  options: AdvancedSettings;
  top: number;
  params: OtoParams;
  durationMs: number;
  offsetMs: number;
  powerHeight: number;
  pitchHeight: number;
}) => {
  const [analysis, setAnalysis] = useState<AudioAnalysis>({
    power: [],
    pitch: [],
  });
  const canvas = useRef<HTMLCanvasElement>(null);
  const markerLayer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const worker = new Worker(
      new URL("../../workers/audio-analysis.ts", import.meta.url),
      { type: "module" }
    );
    const analyze = wrap<AudioAnalysisWorker>(worker);
    let request = 0;
    let disposed = false;
    const start = async () => {
      const buffer = instance.getDecodedData();
      if (buffer === null) {
        return;
      }
      const samples = new Float32Array(buffer.length);
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < samples.length; i += 1) {
          samples[i] =
            (samples[i] ?? 0) + (data[i] ?? 0) / buffer.numberOfChannels;
        }
      }
      request += 1;
      const currentRequest = request;
      try {
        const result = await analyze(
          transfer(samples, [samples.buffer]),
          buffer.sampleRate,
          options
        );
        if (!disposed && currentRequest === request) {
          setAnalysis(result);
        }
      } catch (error) {
        if (!disposed && currentRequest === request) {
          notify("error", `音声解析に失敗しました: ${String(error)}`);
        }
      }
    };
    worker.addEventListener("error", () => {
      if (!disposed) {
        notify("error", "音声解析Workerを起動できません。");
      }
    });
    const off = instance.on("decode", () => {
      void start();
    });
    if (instance.getDecodedData() !== null) {
      void start();
    }
    return () => {
      off();
      disposed = true;
      analyze[releaseProxy]();
      worker.terminate();
    };
  }, [instance, options]);
  useEffect(() => {
    const draw = () => {
      const element = canvas.current;
      if (element === null) {
        return;
      }
      const width = element.clientWidth;
      const height = powerHeight + pitchHeight;
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      const ctx = element.getContext("2d");
      if (ctx === null) {
        return;
      }
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, width, height);
      const duration = instance.getDuration();
      const zoom =
        instance.getWrapper().clientWidth / Math.max(duration, 0.001);
      const x = (seconds: number) => seconds * zoom - instance.getScroll();
      const track = (
        points: AudioAnalysis["power"],
        y: (value: number) => number,
        color: string
      ) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        for (const point of points) {
          const px = x(point.time);
          if (
            px < -10 ||
            px > width + 10 ||
            (point.value === 0 && points === analysis.pitch)
          ) {
            started = false;
            continue;
          }
          if (started) {
            ctx.lineTo(px, y(point.value));
          } else {
            ctx.moveTo(px, y(point.value));
            started = true;
          }
        }
        ctx.stroke();
      };
      ctx.font = `${options.fontSize}px ${options.fontFamily}`;
      if (options.showPower) {
        track(
          analysis.power,
          (value) =>
            Math.max(0, Math.min(powerHeight, (-value / 100) * powerHeight)),
          options.colors.power
        );
        ctx.fillStyle = options.colors.power;
        ctx.fillText("パワー (dB)", 5, 14);
      }
      if (options.showPitch) {
        const voiced = analysis.pitch
          .map((point) => point.value)
          .filter((value) => value > 0);
        let min = options.pitchMin;
        let max = options.pitchMax;
        for (const hz of voiced) {
          min = Math.min(min, hz);
          max = Math.max(max, hz);
        }
        min = options.pitchFixedRange
          ? options.pitchDisplayMin
          : Math.max(20, min);
        max = options.pitchFixedRange ? options.pitchDisplayMax : max;
        const transform = (value: number) =>
          options.pitchUnit === "hz" ? value : 12 * Math.log2(value / 440);
        const low = transform(min);
        const high = Math.max(low + 1, transform(max));
        const y = (value: number) =>
          powerHeight +
          (1 - (transform(value) - low) / (high - low)) * pitchHeight;
        if (options.toneGrid) {
          ctx.strokeStyle = options.colors.grid;
          ctx.fillStyle = options.colors.grid;
          for (
            let midi = Math.ceil(69 + 12 * Math.log2(min / 440));
            midi <= Math.floor(69 + 12 * Math.log2(max / 440));
            midi += 1
          ) {
            const hz = 440 * 2 ** ((midi - 69) / 12);
            const py = y(hz);
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(width, py);
            ctx.stroke();
            if (pitchHeight / Math.max(1, high - low) > 8 || midi % 12 === 0) {
              ctx.fillText(
                options.pitchUnit === "hz" ? `${Math.round(hz)}` : noteName(hz),
                4,
                py - 2
              );
            }
          }
        }
        if (
          options.showTargetPitch &&
          options.targetPitch >= min &&
          options.targetPitch <= max
        ) {
          ctx.strokeStyle = options.colors.target;
          ctx.beginPath();
          ctx.moveTo(0, y(options.targetPitch));
          ctx.lineTo(width, y(options.targetPitch));
          ctx.stroke();
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, powerHeight, width, pitchHeight);
        ctx.clip();
        track(analysis.pitch, y, options.colors.pitch);
        ctx.restore();
        ctx.fillStyle = options.colors.pitch;
        ctx.fillText("F0", 5, powerHeight + 14);
      }
      const positions = toPositions(params, durationMs);
      for (const marker of MARKERS) {
        const px = x((positions[marker] - offsetMs) / 1000);
        updateMarkerHit(markerLayer.current, marker, px, width);
        ctx.strokeStyle = options.colors[marker];
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
      }
    };
    draw();
    const stops = [
      instance.on("scroll", draw),
      instance.on("zoom", draw),
      instance.on("redrawcomplete", draw),
    ];
    const observer = new ResizeObserver(draw);
    if (canvas.current !== null) {
      observer.observe(canvas.current);
    }
    return () => {
      for (const stop of stops) {
        stop();
      }
      observer.disconnect();
    };
  }, [
    analysis,
    instance,
    options,
    powerHeight,
    pitchHeight,
    params,
    durationMs,
    offsetMs,
  ]);
  return (
    <>
      <canvas
        aria-label="パワーとF0の解析表示"
        ref={canvas}
        className="absolute right-0 left-0 w-full"
        style={{ top, height: powerHeight + pitchHeight }}
      />
      <div
        ref={markerLayer}
        className="pointer-events-none absolute right-0 left-0 overflow-hidden"
        style={{ top, height: powerHeight + pitchHeight }}
      >
        {MARKERS.map((marker) => (
          <div
            key={marker}
            data-marker={marker}
            data-analysis-marker
            title={MARKER_LABELS[marker]}
            className="pointer-events-auto absolute inset-y-0 w-[14px] cursor-ew-resize"
          />
        ))}
      </div>
    </>
  );
};
