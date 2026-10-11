/* eslint-disable jsx-a11y/prefer-tag-over-role -- 操作可能なスプリッターであり、文書の区切りhrではない。 */
import { useRef, useState } from "react";
import type { PointerEvent } from "react";

import type { AudioPanel } from "./audio-panel-layout";

export const PanelHeightGrip = ({
  panel,
  top,
  height,
  min,
  max,
  onResize,
}: {
  panel: AudioPanel;
  top: number;
  height: number;
  min: number;
  max: number;
  onResize: (height: number) => void;
}) => {
  const drag = useRef<{ y: number; height: number } | null>(null);
  const [delta, setDelta] = useState(0);
  const commit = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== null) {
      onResize(drag.current.height + event.clientY - drag.current.y);
    }
    drag.current = null;
    setDelta(0);
  };
  return (
    <div
      role="separator"
      aria-label={
        {
          waveHeight: "波形の高さ",
          specHeight: "スペクトログラムの高さ",
          powerHeight: "パワーの高さ",
          pitchHeight: "F0の高さ",
        }[panel]
      }
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={height}
      tabIndex={0}
      data-panel-resizer
      className="bg-line hover:bg-accent/60 focus-visible:bg-accent absolute right-0 left-0 z-20 h-1 cursor-row-resize outline-none"
      style={{ top: top + delta - 2 }}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        drag.current = { y: event.clientY, height };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current !== null) {
          const nextHeight = Math.max(
            min,
            Math.min(max, drag.current.height + event.clientY - drag.current.y)
          );
          setDelta(nextHeight - drag.current.height);
        }
      }}
      onPointerUp={commit}
      onPointerCancel={() => {
        drag.current = null;
        setDelta(0);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          onResize(height + (event.key === "ArrowUp" ? -20 : 20));
        }
      }}
    />
  );
};
