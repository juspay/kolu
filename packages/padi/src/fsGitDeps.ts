import type { padiSurface } from "@kolu/padi-client/surface";
import type { ImplementSurfaceDeps } from "@kolu/surface/server";
import type { Logger } from "pino";
import { askerLabel } from "./diagnostics/askers.ts";
import type { TerminalEndpoint } from "./endpoint.ts";
import { pulseSource } from "./pulseSource.ts";

type PadiDeps = ImplementSurfaceDeps<typeof padiSurface.spec>;

export function padiFsGitDeps(
  endpoint: TerminalEndpoint,
  log: Logger,
): {
  streams: Pick<
    NonNullable<PadiDeps["streams"]>,
    "subscribeRepoChange" | "subscribeFileChange"
  >;
} {
  return {
    streams: {
      subscribeRepoChange: {
        source: ({ repoPath }) =>
          pulseSource(
            (onEvent) =>
              endpoint.fs.subscribeRepoChange(
                repoPath,
                askerLabel.repoChangeStream,
                onEvent,
              ),
            log,
            "subscribeRepoChange",
          ),
      },
      subscribeFileChange: {
        source: ({ repoPath, filePath }) =>
          pulseSource(
            (onEvent) =>
              endpoint.fs.subscribeFileChange(
                repoPath,
                filePath,
                askerLabel.fileChangeStream(filePath),
                onEvent,
              ),
            log,
            "subscribeFileChange",
          ),
      },
    },
  };
}
