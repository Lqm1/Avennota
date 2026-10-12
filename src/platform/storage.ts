import { createIndexedDB } from "@tanstack/db";

let database: ReturnType<typeof createIndexedDB> | undefined;
export const openLocalDatabase = async () => {
  database ??= createIndexedDB({
    name: "avennota",
    version: 3,
    stores: ["folders", "recovery", "audio", "models"],
  });
  try {
    return await database;
  } catch (error) {
    database = undefined;
    throw error;
  }
};
