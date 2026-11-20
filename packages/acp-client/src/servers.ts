import type { McpServer } from "@agentclientprotocol/sdk";
import type { Reported } from "@kolu/acp/engine";
import type { Server } from "@kolu/acp/wire";

export interface MissingServer {
  readonly name: string;
  readonly where: string | null;
  readonly why: string;
}

export const rosterOf = (
  handing: ReadonlyArray<McpServer>,
  missing: ReadonlyArray<MissingServer>,
  at: ReadonlyMap<string, string> = new Map(),
): ReadonlyArray<Server> => [
  ...handing.map(
    (server): Server => ({
      name: server.name,
      where: whereOf(server),
      ...(at.has(server.name) ? { at: at.get(server.name)! } : {}),
      standing: "handed",
      said: null,
    }),
  ),
  ...missing.map(
    (one): Server => ({
      name: one.name,
      where: one.where,
      standing: "missing",
      said: one.why,
    }),
  ),
];

const whereOf = (server: McpServer): string | null => {
  if ("url" in server && typeof server.url === "string") return server.url;
  if ("command" in server && typeof server.command === "string")
    return server.command;
  return null;
};

export const movedBy = (
  roster: ReadonlyArray<Server>,
  said: ReadonlyArray<Reported>,
): ReadonlyArray<Server> | null => {
  const moves = roster.map((server) => asSaid(server, said));
  return moves.some((move) => move !== null)
    ? roster.map((server, index) => moves[index] ?? server)
    : null;
};

const asSaid = (
  server: Server,
  said: ReadonlyArray<Reported>,
): Server | null => {
  if (server.standing === "missing") return null;
  const reported = said.find((one) => one.name === server.name);
  if (reported === undefined) return null;
  const standing = reported.attached ? "connected" : "unattached";
  return server.standing === standing && server.said === reported.said
    ? null
    : { ...server, standing, said: reported.said };
};
