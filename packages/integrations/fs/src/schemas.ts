/** Zod schemas for filesystem operations — single source of truth.
 *  Re-exported by kolu-common for contract/client consumption. */

import { z } from "zod";

export const FsListDirInputSchema = z.object({
  terminalId: z.string().uuid(),
  path: z.string(),
});

export const FsDirEntrySchema = z.object({
  name: z.string(),
  isDirectory: z.boolean(),
  path: z.string(),
});

export const FsListDirOutputSchema = z.object({
  entries: z.array(FsDirEntrySchema),
});

export type FsListDirInput = z.infer<typeof FsListDirInputSchema>;
export type FsDirEntry = z.infer<typeof FsDirEntrySchema>;
export type FsListDirOutput = z.infer<typeof FsListDirOutputSchema>;
