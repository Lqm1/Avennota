import { cn } from "cn";

import type { ParamKey } from "../oto/oto-set";

/** Tailwindがクラス名を検出できるよう、色のクラスは静的に列挙する。 */
const swatchClass: Record<ParamKey, string> = {
  consonant: "bg-consonant",
  cutoff: "bg-cutoff",
  offset: "bg-offset",
  overlap: "bg-overlap",
  preutter: "bg-preutter",
};

/** 波形上のマーカーと同じ形の記号。色だけで判別しないために添える。 */
export const PARAM_SHAPES: Record<ParamKey, string> = {
  consonant: "◆",
  cutoff: "▶",
  offset: "◀",
  overlap: "▲",
  preutter: "▼",
};

export const ParamSwatch = ({
  param,
  className,
}: {
  param: ParamKey;
  className?: string;
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "inline-flex size-3 items-center justify-center rounded-sm text-[8px] leading-none text-black/70",
      swatchClass[param],
      className
    )}
  >
    {PARAM_SHAPES[param]}
  </span>
);
