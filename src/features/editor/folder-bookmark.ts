import { z } from "zod";

export const folderBookmarkSchema = z.object({
  id: z.string(),
  name: z.string(),
  nativePath: z.string().nullable(),
});
export type FolderBookmark = z.output<typeof folderBookmarkSchema>;
