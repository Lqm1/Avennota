import type { PlayPoint } from "../editor/settings";
import { toPositions } from "../oto/geometry";
import type { Marker } from "../oto/geometry";
import type { OtoParams } from "../oto/oto-set";

export const pointTime = (
  point: PlayPoint,
  params: OtoParams,
  duration: number
): number => {
  if (point === "head") {
    return 0;
  }
  if (point === "tail") {
    return duration;
  }
  return Math.min(Math.max(toPositions(params, duration)[point], 0), duration);
};
export const nearestPlayRange = (
  params: OtoParams,
  duration: number,
  time: number
): [number, number] => {
  const times = Object.values(toPositions(params, duration));
  return [
    Math.max(0, ...times.filter((ms) => ms < time)),
    Math.min(duration, ...times.filter((ms) => ms > time)),
  ];
};
export const middlePlayRange = (
  marker: Marker,
  params: OtoParams,
  duration: number
): [number, number] => [
  marker === "offset" ? 0 : pointTime("offset", params, duration),
  pointTime(marker, params, duration),
];
