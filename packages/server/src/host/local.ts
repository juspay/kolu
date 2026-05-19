import { spawnPty } from "../pty.ts";
import type { Host } from "./types.ts";

export const localHost: Host = {
  async spawnPty(tlog, terminalId, opts, cwd) {
    return spawnPty(tlog, terminalId, opts, cwd);
  },
  shutdown() {},
};
