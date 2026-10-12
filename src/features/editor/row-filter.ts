import { createStore } from "@tanstack/react-store";

import type { OtoLine, OtoSet } from "../oto/oto-set";

export const rowFilterStore = createStore<ReadonlySet<string> | null>(null);

export const narrowRows = (ids: Iterable<string>): void => {
  rowFilterStore.setState((current) => {
    const next = new Set(ids);
    return current === null
      ? next
      : new Set([...next].filter((id) => current.has(id)));
  });
};

export const visibleLines = (otoSet: OtoSet): OtoLine[] => {
  const filter = rowFilterStore.state;
  return otoSet.lines.filter(
    (line) =>
      line.parsed.kind !== "blank" && (filter === null || filter.has(line.id))
  );
};
