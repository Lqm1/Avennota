import { Throttler } from "@tanstack/pacer";
import { useWavesurfer } from "@wavesurfer/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import HoverPlugin from "wavesurfer.js/dist/plugins/hover.esm.js";
import type { Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import SpectrogramPlugin from "wavesurfer.js/dist/plugins/spectrogram.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";

import type { VoiceFolder } from "../../platform/files";
import { selectCell } from "../editor/cell-selection";
import { PARAM_SHAPES } from "../editor/param-swatch";
import {
  settingsStore,
  updateSettings,
  useSettings,
  showEditorPanel,
} from "../editor/settings";
import {
  selectRelative,
  selectRelativeWav,
  setMarkerPreview,
  updateManyParams,
  editorStore,
  errorText,
  notify,
  useMarkerParams,
  clearMarkerPreview,
} from "../editor/store";
import type { Marker } from "../oto/geometry";
import {
  cutoffEnd,
  MARKER_KEYS,
  MARKER_LABELS,
  MARKERS,
  toPositions,
} from "../oto/geometry";
import {
  moveMarkerWithConstraints,
  shiftRelativeMarkers,
} from "../oto/marker-movement";
import type { ParsedOtoLine, OtoParams } from "../oto/oto-set";
import { withParams } from "../oto/oto-set";
import { AnalysisPanels } from "./analysis-panels";
import {
  useAudioPanelLayout,
  panelResizeBounds,
  resizePanelPair,
} from "./audio-panel-layout";
import { isFilePlaying, playFileRange, stopFilePlayback } from "./file-player";
import { PanelHeightGrip } from "./panel-height-grip";
import { middlePlayRange, nearestPlayRange, pointTime } from "./play-ranges";
import { spectrumColorMap } from "./spectrum-colors";
import { useSpectrumData } from "./spectrum-data";
import { stopTiming } from "./timing-player";
import { loadWavBlob, setDuration, invalidateWavBlob } from "./wav-cache";
import { registerWaveControls } from "./wave-controls";
import { WaveMenu } from "./wave-menu";
import { loadWaveSegment } from "./wave-segment";

class PlaybackSegment {
  update(value: { offsetMs: number; durationMs: number | null }) {
    this.current = value;
  }
  current: { offsetMs: number; durationMs: number | null } = {
    offsetMs: 0,
    durationMs: null,
  };
}
// 時間軸は波形に重ねて表示するため、パネルの高さには加算しない。
const TIMELINE_HEIGHT = 18;
const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 40_000;

type WaveSurfer = NonNullable<ReturnType<typeof useWavesurfer>["wavesurfer"]>;
type AudioState =
  | { kind: "loading" }
  | { kind: "ready"; durationMs: number; offsetMs: number }
  | { kind: "error"; message: string };

type RangeId = "blankLeft" | "fixed" | "blankRight";

const RANGE_COLORS: Record<RangeId, string> = {
  blankLeft: "var(--color-blank)",
  blankRight: "var(--color-blank)",
  fixed: "var(--color-fixed)",
};

const themeColor = (name: string): string =>
  getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${name}`)
    .trim() || "#8ab";

const markerContent = (marker: Marker): HTMLElement => {
  const strip = document.createElement("div");
  strip.title = `${MARKER_LABELS[marker]}（${MARKER_KEYS[marker]}）`;
  strip.dataset.marker = marker;
  Object.assign(strip.style, {
    bottom: "0",
    left: "-7px",
    position: "absolute",
    top: "0",
    width: "14px",
  });
  const label = document.createElement("div");
  label.textContent = `${PARAM_SHAPES[marker]} ${MARKER_LABELS[marker]}`;
  Object.assign(label.style, {
    background: "rgb(0 0 0 / 0.6)",
    borderLeft: `2px solid var(--color-${marker})`,
    color: `var(--color-${marker})`,
    font: "12px/18px var(--font-sans)",
    left: marker === "cutoff" ? "auto" : "7px",
    right: marker === "cutoff" ? "7px" : "auto",
    padding: "2px 5px",
    borderRadius: "3px",
    pointerEvents: "auto",
    position: "absolute",
    top: `${4 + { offset: 0, cutoff: 0, overlap: 1, preutter: 2, consonant: 3 }[marker] * 28}px`,
    whiteSpace: "nowrap",
    // つかみ領域（z-indexなし）より手前に出し、名前でつかんだマーカーが動くようにする。
    zIndex: "1",
  });
  strip.append(label);
  return strip;
};

const markerAt = (event: Event): Marker | undefined => {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement) {
      const marker = MARKERS.find(
        (candidate) =>
          candidate === target.dataset.marker || candidate === target.dataset.id
      );
      if (marker !== undefined) {
        return marker;
      }
    }
  }
  return undefined;
};

interface WaveViewProps {
  folder: VoiceFolder;
  wav: string;
  line: ParsedOtoLine;
  linked: boolean;
}

/** 描画・ズーム・再生はwavesurfer.jsに任せ、原音設定値（ミリ秒）とwavesurferの秒を相互に変換する。 */
export const WaveView = (props: WaveViewProps) => {
  const { folder, wav, line } = props;
  const lineId = line.id;
  const params = line.parsed.oto;
  const hostRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const segment = useMemo(() => new PlaybackSegment(), []);
  // 読み込み結果はWAVごとに持ち、別のWAVへ切り替えたときは自然に未読み込みとして扱う。
  const [audio, setAudio] = useState<AudioState>({ kind: "loading" });
  const durationMs = audio.kind === "ready" ? audio.durationMs : null;
  const shown = useMarkerParams(lineId, params);
  const settings = useSettings();
  const [audioVersion, setAudioVersion] = useState(0);
  const spectrumUrl = useSpectrumData(
    folder,
    wav,
    line,
    settings,
    audioVersion
  );
  const markerAlt = useRef(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const {
    layout,
    latestLayout,
    visibleWaveHeight,
    spectrogramHeight,
    powerHeight,
    pitchHeight,
  } = useAudioPanelLayout(hostRef, settings);
  // 音声操作用の波形は1pxで維持するが、非表示時のレイアウトからは除く。
  const waveHeight = visibleWaveHeight || 1;
  const analysisHeight = powerHeight + pitchHeight;
  const partialTarget = settings.advanced.partialRead ? lineId : "";

  const formatTime = useCallback(
    (localSeconds: number) => {
      const seconds = localSeconds + segment.current.offsetMs / 1000;
      return settings.timeUnit === "seconds"
        ? `${Number(seconds.toFixed(3))}`
        : `${Number((1 + ((seconds - settings.bpmOffset) * settings.bpm) / 240).toFixed(2))}`;
    },
    [segment, settings.timeUnit, settings.bpmOffset, settings.bpm]
  );
  // 高さが変わるとwavesurferを作り直すため、プラグインも同じ単位で作り直す（破棄済みのプラグインは再利用できない）。
  const { plugins, regions } = useMemo(() => {
    const regionsPlugin = RegionsPlugin.create();
    const list = [
      TimelinePlugin.create({
        formatTimeCallback: formatTime,
        height: TIMELINE_HEIGHT,
        insertPosition: "beforebegin",
        style: { color: "#94a3b8", fontSize: "10px" },
      }),
      ...(spectrogramHeight > 0
        ? [
            SpectrogramPlugin.create({
              colorMap: spectrumColorMap(settings.spectrumColor),
              frequenciesDataUrl: spectrumUrl ?? undefined,
              sampleRate: settings.advanced.sampleRate,
              fftSamples: Math.min(
                settings.advanced.windowLength,
                settings.fftSamples
              ),
              fftSize: settings.fftSamples,
              windowFunc: settings.advanced.window,
              preEmphasis: 0,
              gainDB: 20 + settings.advanced.brightness,
              rangeDB: Math.max(1, 80 - settings.advanced.contrast * 0.7),
              frequencyMax: settings.frequencyMax,
              height: spectrogramHeight,
              labels: true,
              labelsBackground: "rgb(0 0 0 / 0.35)",
              scale: "linear",
              useWebWorker: true,
            }),
          ]
        : []),
      regionsPlugin,
      HoverPlugin.create({
        formatTimeCallback: (seconds) =>
          `${(seconds * 1000 + segment.current.offsetMs).toFixed(1)} ms`,
        labelBackground: "rgb(0 0 0 / 0.7)",
        labelColor: "#e2e8f0",
        labelSize: 11,
        lineColor: "rgb(255 255 255 / 0.5)",
      }),
    ];
    return { plugins: list, regions: regionsPlugin };
  }, [
    spectrogramHeight,
    spectrumUrl,
    segment,
    settings.advanced.sampleRate,
    settings.spectrumColor,
    settings.fftSamples,
    settings.frequencyMax,
    formatTime,
    settings.advanced.windowLength,
    settings.advanced.window,
    settings.advanced.brightness,
    settings.advanced.contrast,
  ]);

  const colors = useMemo(
    () => ({
      cursor: themeColor("accent"),
      wave: settings.advanced.colors.wave,
    }),
    [settings.advanced.colors.wave]
  );
  const { wavesurfer, isReady } = useWavesurfer({
    autoCenter: false,
    autoScroll: false,
    backend: "WebAudio",
    container: containerRef,
    cursorColor: colors.cursor,
    dragToSeek: false,
    interact: false,
    height: 100,
    hideScrollbar: false,
    minPxPerSec: MIN_PX_PER_SEC,
    plugins,
    progressColor: colors.wave,
    // 表示・スペクトログラム用のデコード周波数。再生と時間軸には影響しない。
    sampleRate: settings.advanced.sampleRate,
    waveColor: colors.wave,
    normalize: false,
    barHeight: 1,
  });

  useEffect(() => {
    wavesurfer?.setOptions({
      height: waveHeight,
      autoScroll: settings.followPlayMark,
      waveColor: settings.showWave ? colors.wave : "transparent",
      progressColor: settings.showWave ? colors.wave : "transparent",
      normalize: settings.waveScale === 0,
      barHeight: settings.waveScale === 0 ? 1 : 32_768 / settings.waveScale,
    });
  }, [
    wavesurfer,
    waveHeight,
    settings.followPlayMark,
    settings.showWave,
    settings.waveScale,
    colors.wave,
  ]);

  // Regionsプラグインは、現在のwavesurferに登録された後でだけ操作できる（作り直しの途中は古い組み合わせになる）。
  const regionsActive =
    wavesurfer !== null && wavesurfer.getActivePlugins().includes(regions);

  const latest = useRef(props);
  const latestAudio = useRef(audio);
  useLayoutEffect(() => {
    latest.current = props;
    latestAudio.current = audio;
  });
  const pointerMs = useRef<number | null>(null);
  const dragging = useRef(false);
  const scrolledFor = useRef<string | null>(null);
  const gesture = useRef<{
    marker: Marker;
    base: ParsedOtoLine;
    alt: boolean;
    bias: number;
    next: OtoParams;
  } | null>(null);
  const savedView = useRef<{ scroll: number; pxPerSec: number } | null>(null);

  const commitMarker = useCallback(
    (base: ParsedOtoLine, marker: Marker, next: OtoParams, alt: boolean) => {
      const changes = new Map<string, Partial<OtoParams>>([[base.id, next]]);
      const { workspace } = editorStore.state;
      const related =
        marker === "offset"
          ? settingsStore.state.offsetMode === "relative"
          : settingsStore.state.preutterMode === "relative";
      if (
        alt &&
        related &&
        (marker === "offset" || marker === "preutter") &&
        workspace.kind === "open"
      ) {
        const { lines } = workspace.history.present.otoSet;
        const index = lines.findIndex((entry) => entry.id === base.id);
        const delta = next.offset - base.parsed.oto.offset;
        for (const direction of [-1, 1]) {
          for (
            let i = index + direction;
            i >= 0 && i < lines.length;
            i += direction
          ) {
            const neighbor = lines[i];
            if (
              neighbor?.parsed.kind !== "oto" ||
              neighbor.parsed.oto.wav !== base.parsed.oto.wav
            ) {
              break;
            }
            changes.set(
              neighbor.id,
              shiftRelativeMarkers(neighbor.parsed.oto, delta)
            );
          }
        }
      }
      updateManyParams(changes);
    },
    []
  );

  // インスタンスを作り直した場合（表示領域の変更）も読み直す。
  useEffect(() => {
    const register = (instance: WaveSurfer) => {
      setAudio({ kind: "loading" });
      // 表示領域の変更でインスタンスが破棄された場合の読み込み中断は、失敗として扱わない。
      let cancelled = false;
      const offDestroy = instance.on("destroy", () => {
        cancelled = true;
      });
      scrolledFor.current = null;
      regions.clearRegions();
      const load = async () => {
        if (partialTarget !== "" && latest.current.line.id !== partialTarget) {
          return;
        }
        try {
          const loaded = await loadWaveSegment(
            folder,
            wav,
            latest.current.line.parsed.oto,
            {
              ...settingsStore.state,
              autoFocus: settings.autoFocus,
              advanced: {
                ...settingsStore.state.advanced,
                partialRead: settings.advanced.partialRead,
                partialBefore: settings.advanced.partialBefore,
                partialAfter: settings.advanced.partialAfter,
              },
            }
          );
          segment.update({
            offsetMs: loaded.offsetMs,
            durationMs: loaded.durationMs,
          });
          if (!cancelled) {
            await instance.loadBlob(loaded.blob);
          }
        } catch (loadError) {
          // 別のWAVの読み込みに置き換わった場合（AbortError）は失敗として扱わない。
          const aborted =
            loadError instanceof DOMException &&
            loadError.name === "AbortError";
          if (!(cancelled || aborted)) {
            setAudio({ kind: "error", message: errorText(loadError) });
          }
        }
      };
      void load();
      const offDecode = instance.on("decode", (seconds) => {
        const ms = segment.current.durationMs ?? seconds * 1000;
        setAudio({
          kind: "ready",
          durationMs: ms,
          offsetMs: segment.current.offsetMs,
        });
        setDuration(folder, wav, ms);
        const view = savedView.current;
        if (view !== null) {
          instance.zoom(view.pxPerSec);
          instance.setScroll(view.scroll);
        } else if (settingsStore.state.showWhole) {
          instance.zoom(instance.getWidth() / seconds);
        }
      });
      const offError = instance.on("error", (reason) => {
        if (!cancelled) {
          setAudio({ kind: "error", message: reason.message });
        }
      });
      return () => {
        savedView.current = {
          scroll: instance.getScroll(),
          pxPerSec:
            instance.getDuration() > 0
              ? instance.getWrapper().clientWidth / instance.getDuration()
              : MIN_PX_PER_SEC,
        };
        cancelled = true;
        offDestroy();
        offDecode();
        offError();
      };
    };
    return wavesurfer === null ||
      !regionsActive ||
      (settings.showSpec && spectrumUrl === null)
      ? undefined
      : register(wavesurfer);
  }, [
    wavesurfer,
    regionsActive,
    folder,
    wav,
    regions,
    segment,
    partialTarget,
    settings.autoFocus,
    settings.showSpec,
    spectrumUrl,
    settings.advanced.partialRead,
    settings.advanced.partialBefore,
    settings.advanced.partialAfter,
  ]);

  useEffect(() => {
    if (!regionsActive) {
      return;
    }
    if (!(isReady && durationMs !== null)) {
      regions.clearRegions();
      return;
    }
    const seconds = (ms: number) =>
      Math.min(
        Math.max(ms - segment.current.offsetMs, 0),
        (wavesurfer?.getDuration() ?? durationMs / 1000) * 1000
      ) / 1000;
    const end = cutoffEnd(shown, durationMs);
    const ranges: Record<RangeId, [number, number]> = {
      blankLeft: [0, shown.offset],
      blankRight: [end, durationMs],
      fixed: [shown.offset, shown.offset + shown.consonant],
    };
    const markers: Record<Marker, number> = {
      consonant: shown.offset + shown.consonant,
      cutoff: end,
      offset: shown.offset,
      overlap: shown.offset + shown.overlap,
      preutter: shown.offset + shown.preutter,
    };
    const existing = new Map(
      regions.getRegions().map((region) => [region.id, region])
    );
    const rangeIds: RangeId[] = ["blankLeft", "blankRight", "fixed"];
    for (const id of rangeIds) {
      const [from, to] = ranges[id];
      const start = seconds(Math.min(from, to));
      const stop = seconds(Math.max(from, to));
      const region =
        existing.get(id) ??
        regions.addRegion({
          color: RANGE_COLORS[id],
          drag: false,
          end: stop,
          id,
          resize: false,
          start,
        });
      region.setOptions({ end: stop, start });
      const { element } = region;
      if (element === null) {
        continue;
      }
      element.style.pointerEvents = "none";
      if (id === "fixed") {
        // 固定範囲の塗りは波形の下半分に限定し、スペクトログラムには重ねない。
        Object.assign(element.style, {
          top: `${visibleWaveHeight / 2}px`,
          height: `${visibleWaveHeight / 2}px`,
          bottom: "auto",
          overflow: "hidden",
        });
      }
    }
    for (const marker of MARKERS) {
      const position = markers[marker];
      if (
        !Number.isFinite(position) ||
        position < segment.current.offsetMs ||
        position >
          segment.current.offsetMs +
            (wavesurfer?.getDuration() ?? durationMs / 1000) * 1000
      ) {
        existing.get(marker)?.remove();
        continue;
      }
      const region = existing.get(marker);
      if (region) {
        if (!dragging.current || region.start !== seconds(position)) {
          region.setOptions({
            end: seconds(position),
            start: seconds(position),
          });
        }
      } else {
        const created = regions.addRegion({
          color: `var(--color-${marker})`,
          content: markerContent(marker),
          drag: true,
          end: seconds(position),
          id: marker,
          resize: false,
          start: seconds(position),
        });
        if (created.element !== null) {
          created.element.dataset.marker = marker;
        }
      }
    }
  }, [
    regionsActive,
    isReady,
    shown,
    durationMs,
    regions,
    wavesurfer,
    segment,
    visibleWaveHeight,
  ]);

  // ドラッグ中は仮の値だけを更新し（一覧は動かさない）、離したときに1回だけ確定する。
  useEffect(() => {
    const changesFor = (region: Region) => {
      const { current } = latestAudio;
      const { line: selectedLine } = latest.current;
      const marker = MARKERS.find((candidate) => candidate === region.id);
      if (current.kind !== "ready" || marker === undefined) {
        return null;
      }
      return moveMarkerWithConstraints(
        selectedLine.parsed.oto,
        marker,
        region.start * 1000 + segment.current.offsetMs,
        current.durationMs,
        settingsStore.state
      );
    };
    const preview = (region: Region) => {
      const changes = changesFor(region);
      if (changes !== null) {
        dragging.current = true;
        setMarkerPreview({
          lineId: latest.current.line.id,
          params: withParams(latest.current.line.parsed.oto, changes),
        });
      }
    };
    // 仮の値の反映も描画フレーム程度に間引く。マーカー自体はwavesurferがすぐ動かす。
    const throttler = new Throttler(preview, { wait: 16 });
    const offUpdate = regions.on("region-update", (region) => {
      throttler.maybeExecute(region);
    });
    const offUpdated = regions.on("region-updated", (region) => {
      throttler.cancel();
      const changes = changesFor(region);
      dragging.current = false;
      clearMarkerPreview();
      if (changes !== null) {
        const marker = MARKERS.find((candidate) => candidate === region.id);
        if (marker !== undefined) {
          commitMarker(latest.current.line, marker, changes, markerAlt.current);
          if (settingsStore.state.autoNext[marker]) {
            selectRelative(1);
          }
        }
      }
    });
    return () => {
      throttler.cancel();
      clearMarkerPreview();
      offUpdate();
      offUpdated();
    };
  }, [regions, commitMarker, segment]);

  // 別の行を選んだら、その行の左ブランクから先行発声が見えるようにする。値の編集ではスクロールしない。
  useEffect(() => {
    if (!(wavesurfer && isReady && durationMs !== null && durationMs !== 0)) {
      return;
    }
    if (
      scrolledFor.current === `${lineId}:${settings.autoFocus}` ||
      settings.autoFocus === "none" ||
      settings.showWhole
    ) {
      return;
    }
    scrolledFor.current = `${lineId}:${settings.autoFocus}`;
    const pxPerSec =
      wavesurfer.getWrapper().clientWidth / wavesurfer.getDuration();
    const visibleStart = wavesurfer.getScroll() / pxPerSec;
    const visibleEnd = visibleStart + wavesurfer.getWidth() / pxPerSec;
    const from =
      (toPositions(params, durationMs)[settings.autoFocus] -
        segment.current.offsetMs) /
      1000;
    wavesurfer.setScrollTime(
      Math.max(0, from - (visibleEnd - visibleStart) / 2)
    );
  }, [
    wavesurfer,
    isReady,
    lineId,
    params,
    durationMs,
    settings.autoFocus,
    settings.showWhole,
    segment,
  ]);

  const onPointerLeave = useCallback(() => {
    pointerMs.current = null;
  }, []);

  const finishGesture = useCallback(() => {
    const active = gesture.current;
    // Regionsのドラッグはregion-updatedで確定する。ここでは独自のジェスチャーだけを終了する。
    if (active === null) {
      return;
    }
    gesture.current = null;
    commitMarker(active.base, active.marker, active.next, active.alt);
    clearMarkerPreview();
    if (settingsStore.state.autoNext[active.marker]) {
      selectRelative(1);
    }
  }, [commitMarker]);
  const beginGesture = useCallback(
    (marker: Marker, alt: boolean, preserveGrab = false) => {
      const currentAudio = latestAudio.current;
      if (
        gesture.current !== null ||
        pointerMs.current === null ||
        currentAudio.kind !== "ready"
      ) {
        return;
      }
      const base = latest.current.line;
      const bias = preserveGrab
        ? toPositions(base.parsed.oto, currentAudio.durationMs)[marker] -
          pointerMs.current
        : 0;
      const next = moveMarkerWithConstraints(
        base.parsed.oto,
        marker,
        pointerMs.current + bias,
        currentAudio.durationMs,
        settingsStore.state
      );
      gesture.current = { marker, base, alt, bias, next };
      selectCell({ lineId: base.id, column: marker });
      setMarkerPreview({ lineId: base.id, params: next });
    },
    []
  );
  const onContext = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      setContextMenu({
        x: Math.min(event.clientX, window.innerWidth - 260),
        y: Math.min(event.clientY, window.innerHeight - 340),
      });
    },
    [setContextMenu]
  );
  useEffect(() => {
    const container = hostRef.current;
    const register = (element: HTMLElement, instance: WaveSurfer) => {
      const timeAt = (clientX: number): number | null => {
        const currentAudio = latestAudio.current;
        if (currentAudio.kind !== "ready") {
          return null;
        }
        const total = instance.getDuration() * 1000;
        const rect = instance.getWrapper().getBoundingClientRect();
        if (rect.width === 0) {
          return null;
        }
        return (
          Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * total +
          segment.current.offsetMs
        );
      };
      const onPointerMove = (event: PointerEvent) => {
        const rect = instance.getWrapper().getBoundingClientRect();
        const panelTop =
          hostRef.current?.getBoundingClientRect().top ?? rect.top;
        const analysisBottom = panelTop + (hostRef.current?.clientHeight ?? 0);
        pointerMs.current =
          event.clientY >= panelTop && event.clientY < analysisBottom
            ? timeAt(event.clientX)
            : null;
        const active = gesture.current;
        const currentAudio = latestAudio.current;
        if (
          active !== null &&
          pointerMs.current !== null &&
          currentAudio.kind === "ready"
        ) {
          active.next = moveMarkerWithConstraints(
            active.base.parsed.oto,
            active.marker,
            pointerMs.current + active.bias,
            currentAudio.durationMs,
            settingsStore.state
          );
          setMarkerPreview({ lineId: active.base.id, params: active.next });
        }
      };
      const zoomAt = (factor: number, anchorMs: number) => {
        const currentAudio = latestAudio.current;
        if (currentAudio.kind !== "ready") {
          return;
        }
        const total = instance.getDuration() * 1000;
        const wrapper = instance.getWrapper();
        const current = wrapper.clientWidth / (total / 1000);
        const fitPx = instance.getWidth() / (total / 1000);
        const next = Math.min(
          Math.max(current * factor, fitPx),
          Math.min(MAX_PX_PER_SEC, 20_000 / (total / 1000))
        );
        const anchor = (anchorMs - segment.current.offsetMs) / 1000;
        const anchorX = anchor * current - instance.getScroll();
        instance.zoom(next);
        instance.setScroll(anchor * next - anchorX);
        if (settingsStore.state.showWhole) {
          updateSettings({ showWhole: false });
        }
      };
      let returnScroll: number | null = null;
      const restoreScroll = () => {
        if (returnScroll !== null) {
          instance.setScroll(returnScroll);
          returnScroll = null;
        }
      };
      const play = async (start = 0, stop?: number) => {
        const currentAudio = latestAudio.current;
        const end =
          stop ??
          (currentAudio.kind === "ready"
            ? currentAudio.durationMs
            : instance.getDuration() * 1000);
        if (instance.isPlaying() || isFilePlaying()) {
          instance.pause();
          stopFilePlayback();
          restoreScroll();
          return;
        }
        if (end <= start) {
          return;
        }
        stopTiming();
        returnScroll = settingsStore.state.returnToPlayStart
          ? instance.getScroll()
          : null;
        try {
          await (start < segment.current.offsetMs ||
          end > segment.current.offsetMs + instance.getDuration() * 1000
            ? playFileRange(
                await loadWavBlob(folder, wav),
                start,
                end,
                restoreScroll
              )
            : instance.play(
                Math.max(0, start - segment.current.offsetMs) / 1000,
                Math.min(
                  (end - segment.current.offsetMs) / 1000,
                  instance.getDuration()
                )
              ));
        } catch (error) {
          notify("error", `再生できません: ${errorText(error)}`);
        }
      };
      const reload = async () => {
        try {
          invalidateWavBlob(folder, wav);
          if (settingsStore.state.showSpec) {
            setAudioVersion((version) => version + 1);
            return;
          }
          const loaded = await loadWaveSegment(
            folder,
            wav,
            latest.current.line.parsed.oto,
            settingsStore.state
          );
          segment.update({
            offsetMs: loaded.offsetMs,
            durationMs: loaded.durationMs,
          });
          await instance.loadBlob(loaded.blob);
        } catch (error) {
          notify("error", String(error));
        }
      };

      let amplitude = 1;
      const controls = {
        amplify: (factor: number) => {
          amplitude = Math.min(Math.max(amplitude * factor, 0.25), 16);
          instance.setOptions({ barHeight: amplitude });
        },
        fit: () => {
          instance.zoom(instance.getWidth() / instance.getDuration());
          instance.setScroll(0);
          updateSettings({ showWhole: true });
        },
        placeMarker: (marker: Marker) => {
          const currentAudio = latestAudio.current;
          if (currentAudio.kind !== "ready") {
            return;
          }
          const { line: selectedLine } = latest.current;
          const position =
            pointerMs.current ??
            instance.getCurrentTime() * 1000 + segment.current.offsetMs;
          selectCell({ lineId: selectedLine.id, column: marker });
          commitMarker(
            selectedLine,
            marker,
            moveMarkerWithConstraints(
              selectedLine.parsed.oto,
              marker,
              position,
              currentAudio.durationMs,
              settingsStore.state
            ),
            false
          );
          if (settingsStore.state.autoNext[marker]) {
            selectRelative(1);
          }
        },
        beginMarker: beginGesture,
        endMarker: finishGesture,
        reload: () => {
          void reload();
        },
        playAll: () => {
          void play();
        },
        playRange: () => {
          const currentAudio = latestAudio.current;
          if (currentAudio.kind !== "ready") {
            return;
          }
          const current = latest.current.line.parsed.oto;
          void play(
            Math.max(current.offset, 0),
            Math.min(
              cutoffEnd(current, currentAudio.durationMs),
              currentAudio.durationMs
            )
          );
        },
        playVisible: () => {
          const pxPerSec =
            instance.getWrapper().clientWidth / instance.getDuration();
          void play(
            (instance.getScroll() / pxPerSec) * 1000 + segment.current.offsetMs
          );
        },
        playPreset: (index: number) => {
          const range = settingsStore.state.playRanges[index];
          const currentAudio = latestAudio.current;
          if (range !== undefined && currentAudio.kind === "ready") {
            const { oto } = latest.current.line.parsed;
            void play(
              pointTime(range.start, oto, currentAudio.durationMs),
              pointTime(range.end, oto, currentAudio.durationMs)
            );
          }
        },
        scroll: (pages: number) => {
          instance.setScroll(
            instance.getScroll() + instance.getWidth() * pages
          );
        },
        scrollToStart: () => {
          instance.setScroll(0);
        },
        stop: () => {
          instance.pause();
          stopFilePlayback();
          stopTiming();
          restoreScroll();
        },
        zoom: (factor: number) => {
          zoomAt(
            factor,
            pointerMs.current ??
              instance.getDuration() * 500 + segment.current.offsetMs
          );
        },
      };
      const onPointerDown = (event: PointerEvent) => {
        onPointerMove(event);
        const marker = markerAt(event);
        if (event.button === 1 && marker !== undefined) {
          event.preventDefault();
          event.stopPropagation();
          const currentAudio = latestAudio.current;
          if (currentAudio.kind === "ready") {
            void play(
              ...middlePlayRange(
                marker,
                latest.current.line.parsed.oto,
                currentAudio.durationMs
              )
            );
          }
          return;
        }
        if (
          event.button !== 0 ||
          pointerMs.current === null ||
          latestAudio.current.kind !== "ready"
        ) {
          return;
        }
        setContextMenu(null);
        if (marker !== undefined) {
          markerAlt.current = event.altKey;
          selectCell({ lineId: latest.current.line.id, column: marker });
          if (
            event
              .composedPath()
              .some(
                (target) =>
                  target instanceof HTMLElement &&
                  Object.hasOwn(target.dataset, "analysisMarker")
              )
          ) {
            beginGesture(marker, event.altKey, true);
          }
          return;
        }
        const mode = settingsStore.state.clickMode;
        if (mode === "timing") {
          beginGesture("preutter", event.altKey);
        }
        if (mode === "range" && gesture.current === null) {
          void play(
            ...nearestPlayRange(
              latest.current.line.parsed.oto,
              latestAudio.current.durationMs,
              pointerMs.current
            )
          );
        }
      };
      const onWheel = (event: WheelEvent) => {
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          return;
        }
        event.preventDefault();
        const direction = event.deltaY > 0 ? 1 : -1;
        if (event.ctrlKey && event.shiftKey) {
          const rect = instance.getWrapper().getBoundingClientRect();
          const panels = latestLayout.current;
          const index = panels.findIndex(
            ({ top, height }) =>
              event.clientY -
                (hostRef.current?.getBoundingClientRect().top ?? rect.top) <
              top + height
          );
          const boundary = Math.min(index, panels.length - 2);
          const panel = panels[boundary];
          const next = panels[boundary + 1];
          if (panel !== undefined && next !== undefined) {
            updateSettings(
              resizePanelPair(
                settingsStore.state,
                panel,
                next,
                panel.height + direction * 20 * (index === boundary ? 1 : -1)
              )
            );
          }
        } else if (event.ctrlKey || event.metaKey) {
          zoomAt(
            direction > 0 ? 1 / 1.5 : 1.5,
            timeAt(event.clientX) ?? instance.getDuration() * 500
          );
        } else if (event.shiftKey) {
          controls.scroll(direction * 0.1);
        } else if (event.altKey) {
          selectRelativeWav(direction);
        } else {
          const { top } = element.getBoundingClientRect();
          const bottom = top + (hostRef.current?.clientHeight ?? 0);
          if (event.clientY < top || event.clientY >= bottom) {
            controls.scroll(direction * 0.1);
          } else {
            selectRelative(direction);
          }
        }
      };
      const unregister = registerWaveControls(controls);
      element.addEventListener("pointermove", onPointerMove);
      element.addEventListener("pointerleave", onPointerLeave);
      element.addEventListener("wheel", onWheel, { passive: false });
      element.addEventListener("pointerdown", onPointerDown, true);
      element.addEventListener("contextmenu", onContext);
      window.addEventListener("pointerup", finishGesture);
      window.addEventListener("blur", finishGesture);
      const offFinish = instance.on("finish", restoreScroll);
      const offPause = instance.on("pause", restoreScroll);
      return () => {
        finishGesture();
        stopFilePlayback();
        unregister();
        offFinish();
        offPause();
        element.removeEventListener("pointermove", onPointerMove);
        element.removeEventListener("pointerleave", onPointerLeave);
        element.removeEventListener("wheel", onWheel);
        element.removeEventListener("pointerdown", onPointerDown, true);
        element.removeEventListener("contextmenu", onContext);
        window.removeEventListener("pointerup", finishGesture);
        window.removeEventListener("blur", finishGesture);
      };
    };
    return container === null || wavesurfer === null
      ? undefined
      : register(container, wavesurfer);
  }, [
    wavesurfer,
    onPointerLeave,
    commitMarker,
    folder,
    wav,
    beginGesture,
    finishGesture,
    onContext,
    setAudioVersion,
    segment,
    latestLayout,
  ]);

  return (
    <figure
      aria-label={`${wav}の波形とスペクトログラム`}
      className="relative m-0 h-full min-h-0 overflow-auto"
      ref={hostRef}
    >
      <button
        type="button"
        className="bg-panel absolute top-0 left-0 z-10 px-1 text-[10px] text-slate-400"
        onClick={() => {
          updateSettings({
            timeUnit: settings.timeUnit === "seconds" ? "bars" : "seconds",
          });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          showEditorPanel("bpm");
        }}
      >
        {settings.timeUnit === "seconds" ? "Sec." : "Bar"}
      </button>
      {/* 周波数ラベルがマーカーの上に重なってもつかめるよう、ラベルはポインター操作を透過させる。 */}
      <div
        className="select-none [&>div::part(spec-labels)]:pointer-events-none"
        data-wave
        ref={containerRef}
        style={{
          paddingBottom: analysisHeight,
          marginTop: settings.showWave ? 0 : -1,
        }}
      />
      {wavesurfer !== null && durationMs !== null && analysisHeight > 0 ? (
        <AnalysisPanels
          instance={wavesurfer}
          options={settings.advanced}
          powerHeight={powerHeight}
          pitchHeight={pitchHeight}
          top={visibleWaveHeight + spectrogramHeight}
          params={shown}
          durationMs={durationMs}
          offsetMs={audio.kind === "ready" ? audio.offsetMs : 0}
        />
      ) : null}
      {layout.slice(0, -1).map((panel, index) => {
        const next = layout[index + 1];
        if (next === undefined) {
          return null;
        }
        return (
          <PanelHeightGrip
            key={panel.panel}
            panel={panel.panel}
            top={panel.top + panel.height}
            height={panel.height}
            {...panelResizeBounds(panel, next)}
            onResize={(height) => {
              updateSettings(
                resizePanelPair(settingsStore.state, panel, next, height)
              );
            }}
          />
        );
      })}
      {contextMenu === null ? null : (
        <WaveMenu
          position={contextMenu}
          onClose={() => {
            setContextMenu(null);
          }}
        />
      )}
      {audio.kind === "error" ? (
        <div className="bg-surface/90 absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-300">
          {wav}を読み込めません: {audio.message}
        </div>
      ) : null}
      {audio.kind === "loading" ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-xs text-slate-500">
          {wav}を読み込んでいます…
        </div>
      ) : null}
    </figure>
  );
};

export const WavePlaceholder = ({ message }: { message: string }) => (
  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-400">
    {message}
  </div>
);
