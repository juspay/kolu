import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import type { Surface } from "@kolu/surface/define";
import { type AgentDial, dialAgentOnce } from "@kolu/surface-remote";
import {
  assertPadiSurfaceCompatible,
  type PadiSurfaceClient,
} from "@kolu/padi-client/dial";
import {
  padiDaemonGroup,
  type padiSurface,
  padiSurfaceSibling,
} from "@kolu/padi-client/surface";
import { Effect } from "effect";
import { composeSpawnEnv } from "kolu-pty";

/** How a remote kolu-managed padi is reached — the CLOSURE provisioned onto the
 *  host (the daemon PLUS the client CLIs a terminal there must be able to run)
 *  and the BINARY exec'd inside it. One value, so no dial path can name half of
 *  it; both dial paths import THIS. */
export const PADI_REMOTE_DIAL = {
  package: "padi-agent",
  binary: "padi",
} as const;

const padiRemoteDialSurface: Surface<typeof padiSurface.spec> = {
  ...padiSurfaceSibling,
  group: padiDaemonGroup,
};

export function dialPadiViaHost(host: string): Promise<AgentDial> {
  return dialAgentOnce({
    surface: padiRemoteDialSurface,
    host,
    localEnv: composeSpawnEnv(process.env),
    ...PADI_REMOTE_DIAL,
    fatalPrefix: "padi --stdio:",
    probe: (client) => {
      const face = client as unknown as PadiSurfaceClient;
      return Effect.map(
        firstFrameOrThrow(
          face.surface.identity.get(undefined),
          "padi handshake failed — the identity cell yielded no frame",
        ),
        (identity) => {
          assertPadiSurfaceCompatible(identity.surfaceVersion);
        },
      );
    },
  });
}
