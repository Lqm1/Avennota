import { createCollection, indexedDBCollectionOptions } from "@tanstack/db";
import { z } from "zod";

import { openLocalDatabase } from "../../platform/storage";

export const acousticModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parameters: z.instanceof(ArrayBuffer),
  phonemap: z.string().min(1),
});

const openModels = async () => {
  const collection = createCollection(
    indexedDBCollectionOptions({
      id: "acoustic-models",
      db: await openLocalDatabase(),
      name: "models",
      schema: acousticModelSchema,
      getKey: (model) => model.id,
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

let models: ReturnType<typeof openModels> | undefined;
export const acousticModelCollection = async () => {
  models ??= openModels();
  try {
    return await models;
  } catch (error) {
    models = undefined;
    throw error;
  }
};
