/** kolu-server BOOTS with a delivery bake and the Agents switch on — the
 *  arrangement every installed kolu (the `default` wrapper) runs in, and one
 *  no e2e scenario reaches: the suite's server has no delivery bake, so the
 *  delivery is never installed there.
 *
 *  Installing the delivery delivers at once (the schedule's first tick runs
 *  on install, and publishes whether each profile builds into the
 *  `agentProfiles` cell). A boot that installs it before that cell is served
 *  throws on that first publish, inside a floating run — the fatal
 *  `unhandledRejection` handler then exits the process. This spawns the real
 *  `kolu web` (the `kolu` binary's source entry) and requires it to serve, run
 *  that first delivery, and stay up. */

import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { store } from "../state.ts";
import { AGENT_DISTRO_DELIVERY_ENV } from "./bake.ts";

const REPO_ROOT = new URL("../../../..", import.meta.url).pathname;
const BOOT_TIMEOUT_MS = 120_000;
/** How long the server must stay up after its first delivery started. */
const SURVIVE_MS = 3_000;

/** A port free right now (the OS picks it; the listener closes at once). */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });

let child: ChildProcess | undefined;
let root: string | undefined;

afterEach(() => {
  if (child?.exitCode === null) child.kill("SIGTERM");
  child = undefined;
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("kolu-server boot with a delivery bake", () => {
  it(
    "serves, runs the first delivery with Agents on, and stays up",
    async () => {
      root = mkdtempSync(join(tmpdir(), "kolu-boot-delivery-"));
      const stateDir = join(root, "state");
      const runtimeDir = join(root, "run");
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(runtimeDir, { recursive: true });
      chmodSync(runtimeDir, 0o700);

      // Agents on, in this kolu's own on-disk shape: the lane's store record
      // (written by the real `state.ts`, migrations and all) with the switch
      // flipped.
      const record = JSON.parse(readFileSync(store.path, "utf8"));
      record.preferences = {
        ...record.preferences,
        agentDistro: { enabled: true, profiles: [] },
      };
      writeFileSync(join(stateDir, "config.json"), JSON.stringify(record));

      // A delivery bake whose index answers nothing (the discard port): the
      // first delivery reaches no host anyway — no padi is connected yet.
      const bake = join(root, "delivery.json");
      writeFileSync(
        bake,
        JSON.stringify({
          flake: "github:juspay/agent-distro",
          index: "http://127.0.0.1:9/index",
          cache: { url: "http://127.0.0.1:9", publicKey: "boot-test:AAAA" },
          schedule: { periodSeconds: 21600, offsetSeconds: 7200 },
        }),
      );

      const port = await freePort();
      let out = "";
      // The `kolu` binary's source entry, as `scripts/kolu-source-wrapper.sh`
      // runs it (minus its `git` lookup of the root, and the client bundle a
      // boot does not need), with kolu-server's own `tsx`.
      child = spawn(
        join(REPO_ROOT, "packages/server/node_modules/.bin/tsx"),
        [
          join(REPO_ROOT, "packages/kolu-cli/src/main.ts"),
          "web",
          "--allow-nix-shell-with-env-whitelist",
          "HOME,USER,PATH,TERM,LANG",
          "--port",
          String(port),
        ],
        {
          cwd: REPO_ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            KOLU_STATE_DIR: stateDir,
            KOLU_PADI_STATE_DIR: join(root, "padi"),
            XDG_RUNTIME_DIR: runtimeDir,
            KOLU_KAVAL_SPAWN: "detached",
            // padi (and its kaval) die with this test process.
            KOLU_DAEMON_BIND_PID: String(process.pid),
            [AGENT_DISTRO_DELIVERY_ENV]: bake,
          },
        },
      );
      child.stdout?.on("data", (d) => {
        out += String(d);
      });
      child.stderr?.on("data", (d) => {
        out += String(d);
      });
      const running = child;
      const alive = () => {
        if (running.exitCode !== null || running.signalCode !== null)
          throw new Error(
            `kolu-server exited (${running.exitCode ?? running.signalCode}):\n${out}`,
          );
      };

      // It serves…
      const deadline = Date.now() + BOOT_TIMEOUT_MS;
      for (;;) {
        alive();
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
            signal: AbortSignal.timeout(2_000),
          });
          if (res.ok) break;
        } catch {
          // Not serving yet: the deadline is the bound.
        }
        if (Date.now() > deadline)
          throw new Error(`kolu-server never served:\n${out}`);
        await sleep(250);
      }
      // …its first delivery ran (Agents on, never delivered: due at once)…
      while (!out.includes("agent-distro delivery due")) {
        alive();
        if (Date.now() > deadline)
          throw new Error(`no first delivery:\n${out}`);
        await sleep(250);
      }
      // …and it is still up after it.
      await sleep(SURVIVE_MS);
      alive();
      expect(out).not.toContain("unhandled rejection");
    },
    BOOT_TIMEOUT_MS + 30_000,
  );
});
