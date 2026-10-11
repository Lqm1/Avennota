import { createCollection, indexedDBCollectionOptions } from "@tanstack/db";
import { z } from "zod";

import { openLocalDatabase } from "../../platform/storage";

const openClips = async () => {
  const collection = createCollection(
    indexedDBCollectionOptions({
      id: "timing-click",
      db: await openLocalDatabase(),
      name: "audio",
      schema: z.object({
        id: z.literal("timing-click"),
        bytes: z.instanceof(ArrayBuffer),
      }),
      getKey: (clip) => clip.id,
      gcTime: Infinity,
    })
  );
  try {
    await collection.preload();
    return collection;
  } catch (error) {
    await collection.cleanup();
    throw error;
  }
};
let clips: ReturnType<typeof openClips> | undefined;
export const timingClickCollection = async () => {
  clips ??= openClips();
  try {
    return await clips;
  } catch (error) {
    clips = undefined;
    throw error;
  }
};
