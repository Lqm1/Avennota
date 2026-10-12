import type { OtoSet } from "../oto/oto-set";
import { effectiveAlias, isOtoLine } from "../oto/oto-set";
import { deleteLines } from "./batch";
import type { BatchResult } from "./batch";

export interface DuplicateGroup {
  key: string;
  lineIds: string[];
}

export const findDuplicateGroups = (
  otoSet: OtoSet,
  ignore: RegExp | null = null
): DuplicateGroup[] => {
  const groups = new Map<string, string[]>();
  for (const line of otoSet.lines) {
    if (!isOtoLine(line)) {
      continue;
    }
    const alias = effectiveAlias(line.parsed.oto);
    const key = ignore === null ? alias : alias.replace(ignore, "");
    groups.set(key, [...(groups.get(key) ?? []), line.id]);
  }
  return [...groups]
    .filter(([, lineIds]) => lineIds.length > 1)
    .map(([key, lineIds]) => ({ key, lineIds }));
};

export const removeDuplicates = (
  otoSet: OtoSet,
  groups: readonly DuplicateGroup[],
  keep: ReadonlySet<string>,
  allowLastRow: boolean
): BatchResult =>
  deleteLines(
    otoSet,
    new Set(
      groups.flatMap((group) =>
        group.lineIds.some((id) => keep.has(id))
          ? group.lineIds.filter((id) => !keep.has(id))
          : []
      )
    ),
    allowLastRow
  );
