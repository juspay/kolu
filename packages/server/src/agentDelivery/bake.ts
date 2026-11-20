import { readFileSync } from "node:fs";
import {
  type AgentDistroDelivery,
  parseAgentDistroDelivery,
} from "@kolu/agent-distro/bake";

export const AGENT_DISTRO_DELIVERY_ENV = "KOLU_AGENT_DISTRO_DELIVERY";

export function readAgentDistroDeliveryBake(
  env: Record<string, string | undefined> = process.env,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
): AgentDistroDelivery | null {
  const path = env[AGENT_DISTRO_DELIVERY_ENV];
  if (path === undefined || path === "") return null;
  return parseAgentDistroDelivery(readText(path));
}
