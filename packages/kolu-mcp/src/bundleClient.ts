import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { clientAt, type RootedSurfaceClients } from "@kolu/surface/client";
import { ToolFailure } from "@kolu/surface-mcp/tools";

export interface KoluSurfaceClients extends RootedSurfaceClients {
  readonly core: PadiSurfaceClient;
}

export function padiOf(client: unknown): PadiSurfaceClient {
  const core = clientAt(client as KoluSurfaceClients, undefined);
  if (core === undefined) {
    throw new ToolFailure(
      "this bundle's client carries no core — kolu's verbs address padi, which is the bundle's core, so the dialled bundle is a leg short of the roster being served",
      { reason: "no-core" },
    );
  }
  return core as PadiSurfaceClient;
}
