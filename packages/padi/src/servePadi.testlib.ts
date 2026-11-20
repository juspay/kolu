import type { Logger } from "pino";
import { startPadiDiagnostics } from "./diagnostics/index.ts";
import type { TerminalEndpoint } from "./endpoint.ts";

export const stubLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => stubLog,
} as unknown as Logger;

export const testDiagnostics = startPadiDiagnostics(stubLog);

export const fakeEndpoint = {
  fs: {
    listAll: async () => [],
    listIgnored: async () => [],
    listDirectory: async () => [],
    readFile: async () => ({ content: "", truncated: false }),
    filePreviewTag: async () => "tag",
    subscribeRepoChange: () => () => {},
    subscribeFileChange: () => () => {},
  },
  git: {
    getStatus: async () => ({}),
    getDiff: async () => ({}),
  },
} as unknown as TerminalEndpoint;
