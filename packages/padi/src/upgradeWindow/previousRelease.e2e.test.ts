/**
 * The real thing, once — boot the PREVIOUS RELEASE's kaval, then bring up the
 * CURRENT build's padi against it and drive Restart kaval (`lifecycle.recycleKaval`).
 *
 * Slow by design: resolves the previous kaval binary (env override, or
 * `nix build` of the latest git tag / last kaval-touching rev), spawns it at
 * the digest-keyed socket for a private state-root, starts current padi, creates
 * a terminal, recycles, asserts the daemon was replaced and the session
 * survived (parked for restore).
 *
 * Own CI recipe (`ci::upgrade-window`) so the ordinary daemon lane stays
 * fast. Generous timeouts; deterministic waits (poll readiness, never
 * sleep-and-hope).
 *
 * Skip (not fail) when the previous binary cannot be resolved — a bare
 * workstation without nix / tags. CI always supplies it.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type UnixSocketConnection,
  unixSocketLink,
} from "@kolu/surface/links/unix-socket";
import { DAEMON_BIND_PID_ENV, gatePid } from "@kolu/surface-daemon";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { KAVAL_GATE_FILE } from "kaval";
import {
  padiGatePath,
  padiKavalSocketPath,
  padiSocketPath,
  writeStateRootManifest,
} from "../stateRoot.ts";
import type { PadiDaemonContract } from "../surface.ts";

const execFileAsync = promisify(execFile);

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC, "../../../..");
const PADI_BIN = join(REPO_ROOT, "packages/padi/src/daemonBoot/bin.ts");
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;

const RUNTIME_ROOT = mkdtempSync(join(tmpdir(), "upgrade-window-rt-"));
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

type PadiConn = UnixSocketConnection<PadiDaemonContract>;

interface Proc {
  child: ChildProcess;
  exited: Promise<number | null>;
}

const procs: Proc[] = [];

beforeAll(() => {
  vi.stubEnv(DAEMON_BIND_PID_ENV, String(process.pid));
  vi.stubEnv("XDG_RUNTIME_DIR", RUNTIME_ROOT);
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(RUNTIME_ROOT, { recursive: true, force: true });
});
afterEach(async () => {
  for (const p of procs.splice(0)) {
    if (p.child.exitCode === null) {
      try {
        p.child.kill("SIGTERM");
      } catch {
        // gone
      }
      await Promise.race([p.exited, sleep(2000)]);
      if (p.child.exitCode === null) {
        try {
          p.child.kill("SIGKILL");
        } catch {
          // gone
        }
      }
    }
  }
});

function track(child: ChildProcess): Proc {
  const exited = new Promise<number | null>((res) =>
    child.on("exit", (code) => res(code)),
  );
  const p = { child, exited };
  procs.push(p);
  return p;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the previous-release kaval binary.
 *
 *  Order:
 *    1. `KOLU_PREVIOUS_KAVAL_BIN` (CI recipe sets this after `nix build`)
 *    2. `nix build` of the latest usable git tag's `#kaval` package
 *    3. last master rev that touched packages/kaval (fallback)
 *
 *  Returns null when none of those work (local skip). */
async function resolvePreviousKavalBin(): Promise<string | null> {
  const envBin = process.env.KOLU_PREVIOUS_KAVAL_BIN;
  if (envBin && existsSync(envBin)) return envBin;

  // Prefer the latest tag; fall back to last rev that changed kaval.
  let ref = "v2.0.0";
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["tag", "--sort=-v:refname"],
      { cwd: REPO_ROOT },
    );
    const tag = stdout
      .split("\n")
      .map((t) => t.trim())
      .find((t) => /^v\d+\.\d+\.\d+$/.test(t));
    if (tag) ref = tag;
  } catch {
    // keep default
  }

  // Confirm the ref exists; else last kaval-touching rev.
  try {
    await execFileAsync("git", ["rev-parse", "--verify", ref], {
      cwd: REPO_ROOT,
    });
  } catch {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["log", "-1", "--format=%H", "--", "packages/kaval"],
        { cwd: REPO_ROOT },
      );
      ref = stdout.trim() || ref;
    } catch {
      return null;
    }
  }

  // Build that ref's kaval via nix (slow; CI recipe pre-builds when it can).
  try {
    const { stdout } = await execFileAsync(
      "nix",
      [
        "build",
        "--no-link",
        "--print-out-paths",
        `git+file://${REPO_ROOT}?ref=${ref}#kaval`,
      ],
      {
        cwd: REPO_ROOT,
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const out = stdout.trim().split("\n").at(-1);
    if (!out) return null;
    const bin = join(out, "bin", "kaval");
    return existsSync(bin) ? bin : null;
  } catch (err) {
    console.warn(
      "previousRelease.e2e: could not nix-build previous kaval:",
      (err as Error).message,
    );
    return null;
  }
}

async function waitForSocket(
  socketPath: string,
  probe: (path: string) => Promise<void>,
  ms = 60_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      await probe(socketPath);
      return;
    } catch (err) {
      lastErr = err;
      await sleep(200);
    }
  }
  throw new Error(
    `socket never ready at ${socketPath}: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

describeDaemon(
  "previous-release kaval × current padi (upgrade-window e2e)",
  () => {
    it("adopts yesterday's kaval, recycleKaval replaces it, session survives for restore", async () => {
      const previousBin = await resolvePreviousKavalBin();
      if (!previousBin) {
        // CI's upgrade-window recipe pre-resolves the binary and sets
        // KOLU_UPGRADE_WINDOW_REQUIRE=1 so a missing binary is a hard fail.
        // Local bare runs without nix/tags skip rather than red.
        if (process.env.KOLU_UPGRADE_WINDOW_REQUIRE === "1") {
          throw new Error(
            "previous-release kaval binary unavailable under KOLU_UPGRADE_WINDOW_REQUIRE=1 — " +
              "set KOLU_PREVIOUS_KAVAL_BIN or ensure nix can build the latest tag's #kaval",
          );
        }
        console.warn(
          "SKIP: no previous-release kaval binary (set KOLU_PREVIOUS_KAVAL_BIN or enable nix+tags)",
        );
        return;
      }

      assertDaemonSpawnAllowed("previous-release kaval + current padi");

      const stateRoot = mkdtempSync(join(tmpdir(), "upgrade-window-sr-"));
      const kavalSocket = padiKavalSocketPath(stateRoot);
      const kavalGate = join(dirname(kavalSocket), KAVAL_GATE_FILE);
      const padiSock = padiSocketPath(stateRoot);

      // Manifest so discovery can label the rendezvous (production does this
      // before kaval binds).
      writeStateRootManifest(dirname(kavalSocket), stateRoot);

      // 1) Boot PREVIOUS-release kaval at the digest-keyed path current padi will dial.
      track(
        spawn(previousBin, ["--socket", kavalSocket], {
          stdio: "ignore",
          env: {
            ...process.env,
            XDG_RUNTIME_DIR: RUNTIME_ROOT,
            [DAEMON_BIND_PID_ENV]: String(process.pid),
          },
        }),
      );

      await waitForSocket(kavalSocket, async (path) => {
        const { unixSocketLink: link } = await import(
          "@kolu/surface/links/unix-socket"
        );
        const conn = await link({ socketPath: path });
        try {
          await (
            conn.client as {
              surface: {
                system: { heartbeat: (i: object) => Promise<unknown> };
              };
            }
          ).surface.system.heartbeat({});
        } finally {
          await conn.dispose();
        }
      });

      const oldPid = gatePid(kavalGate);
      expect(oldPid).toBeTypeOf("number");
      expect(isAlive(oldPid as number)).toBe(true);

      // 2) Boot CURRENT padi against the same state-root. Compatible contract →
      //    adopt (PTYs would survive); we then force-recycle via recycleKaval.
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        XDG_RUNTIME_DIR: RUNTIME_ROOT,
        KOLU_KAVAL_SPAWN: "detached",
        [DAEMON_BIND_PID_ENV]: String(process.pid),
      };
      delete env.INVOCATION_ID;
      delete env.KOLU_KAVAL_BIN;
      delete env.KOLU_KAVAL_SOCKET;
      delete env.KOLU_STATE_DIR;

      track(
        spawn(
          process.execPath,
          [
            "--import",
            TSX_LOADER,
            PADI_BIN,
            "--state-root",
            stateRoot,
            "--allow-nix-shell-with-env-whitelist",
            "default",
          ],
          { stdio: "ignore", env },
        ),
      );

      await waitForSocket(
        padiSock,
        async (path) => {
          const conn = await unixSocketLink<PadiDaemonContract>({
            socketPath: path,
          });
          try {
            await conn.client.surface.control.core.hello();
          } finally {
            await conn.dispose();
          }
        },
        90_000,
      );

      // After adopt, the gate still names the previous-release pid (compatible).
      // (If the previous release were wire-incompatible, converge would have
      // recycled already — still a valid mixed-version proof, just a different
      // arm. We accept either: old pid still live OR already recycled.)
      const pidAfterBoot = gatePid(kavalGate);
      expect(pidAfterBoot).toBeTypeOf("number");

      const conn: PadiConn = await unixSocketLink<PadiDaemonContract>({
        socketPath: padiSock,
      });
      try {
        // 3) Create a terminal so recycle has a session to capture.
        const { id } = await conn.client.surface.padi.lifecycle.create({
          cwd: stateRoot,
        });
        expect(id).toMatch(/^[0-9a-f-]{36}$/);

        // Wait for autosave to persist the session (deterministic poll).
        const confPath = join(stateRoot, "config.json");
        const sessionDeadline = Date.now() + 15_000;
        let sessionPresent = false;
        while (Date.now() < sessionDeadline) {
          if (existsSync(confPath)) {
            try {
              const raw = JSON.parse(readFileSync(confPath, "utf8")) as {
                session?: { terminals?: unknown[] };
              };
              if ((raw.session?.terminals?.length ?? 0) > 0) {
                sessionPresent = true;
                break;
              }
            } catch {
              // mid-write
            }
          }
          await sleep(100);
        }
        expect(sessionPresent).toBe(true);

        const pidBeforeRecycle = gatePid(kavalGate) as number;

        // 4) Restart kaval — the production recycle path.
        await conn.client.surface.padi.lifecycle.recycleKaval(undefined);

        // 5) Daemon replaced: gate pid changed (or the old process is dead and
        //    a new live holder is present).
        const recycleDeadline = Date.now() + 60_000;
        let newPid: number | undefined;
        while (Date.now() < recycleDeadline) {
          const p = gatePid(kavalGate);
          if (p !== undefined && isAlive(p) && p !== pidBeforeRecycle) {
            newPid = p;
            break;
          }
          await sleep(200);
        }
        expect(
          newPid,
          `kaval was not replaced after recycleKaval (still ${pidBeforeRecycle})`,
        ).toBeTypeOf("number");
        expect(isAlive(pidBeforeRecycle)).toBe(false);

        // 6) Session survived for restore — still on disk with the terminal.
        const after = JSON.parse(readFileSync(confPath, "utf8")) as {
          session?: { terminals?: { id: string }[] };
        };
        expect(after.session?.terminals?.length).toBeGreaterThanOrEqual(1);
        // padi itself stayed up (its gate unchanged through a kaval-only recycle).
        const padiPid = gatePid(padiGatePath(padiSock));
        expect(padiPid).toBeTypeOf("number");
        expect(isAlive(padiPid as number)).toBe(true);
      } finally {
        await conn.dispose();
        // Reap kaval (current + any leftover) + padi.
        for (const g of [kavalGate, padiGatePath(padiSock)]) {
          const p = gatePid(g);
          if (p !== undefined && isAlive(p)) {
            try {
              process.kill(p, "SIGKILL");
            } catch {
              // gone
            }
          }
        }
        rmSync(stateRoot, { recursive: true, force: true });
      }
    }, 300_000);
  },
);
