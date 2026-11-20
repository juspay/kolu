import pino, { type Logger } from "pino";
import { serverHostname, serverProcessId } from "./hostname.ts";

const level = process.env.LOG_LEVEL ?? "info";
const base = {
  pid: process.pid,
  hostname: serverHostname,
  serverId: serverProcessId,
};

export const log = pino(
  process.env.NODE_ENV === "production"
    ? { level, base }
    : {
        level,
        base,
        transport: {
          target: "pino-pretty",
          options: { colorize: true, singleLine: true },
        },
      },
);

export type { Logger };
