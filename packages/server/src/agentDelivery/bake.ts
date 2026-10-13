/**
 * The delivery bake — what kolu-server's Nix wrapper tells it about delivering
 * agent-distro's bundles: `KOLU_AGENT_DISTRO_DELIVERY`, a file the Nix half
 * writes from upstream's index, `lib.cache` and `lib.schedule`
 * (`@kolu/agent-distro/bake`). Baked on the floor arm only — the wrapper a user
 * runs — so a from-source kolu-server (`just dev`, e2e) reads `null` and
 * delivers nothing: explicit absence, never a guessed cache.
 */

import { readFileSync } from "node:fs";
import {
  type AgentDistroDelivery,
  parseAgentDistroDelivery,
} from "@kolu/agent-distro/bake";

export const AGENT_DISTRO_DELIVERY_ENV = "KOLU_AGENT_DISTRO_DELIVERY";

/** Read the delivery bake off `env` (injectable for tests): `null` when
 *  unbaked; a baked file that does not parse throws at boot. */
export function readAgentDistroDeliveryBake(
  env: Record<string, string | undefined> = process.env,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
): AgentDistroDelivery | null {
  const path = env[AGENT_DISTRO_DELIVERY_ENV];
  if (path === undefined || path === "") return null;
  return parseAgentDistroDelivery(readText(path));
}
