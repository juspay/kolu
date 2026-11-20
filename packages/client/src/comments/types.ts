import type { Locator } from "@kolu/artifact-sdk/client";

export type { Locator };

export type BrowseSurface = "source" | "prose";

export type Comment = {
  id: string;
  path: string;
  locator: Locator;
  lineRange?: { start: number; end: number };
  surface?: BrowseSurface;
  body: string;
  createdAt: number;
};

export type PersistedShape = { v: 1; comments: Comment[] };
