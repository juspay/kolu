import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { collectLogger } from "@kolu/log/loggerStubs.testutil";
import { type PadiDaemonClient, padiClientOver } from "@kolu/padi-client/dial";
import { padiDigest } from "@kolu/padi-client/rendezvous";
import {
  PADI_SURFACE_VERSION,
  padiDaemonGroup,
  padiSurfaceSibling,
} from "@kolu/padi-client/surface";
import { isContractVersionCompatible } from "@kolu/surface/define";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { assertPreviousReleaseWindow } from "@kolu/surface-daemon/upgrade-window.testlib";
import type { AgentClient } from "@kolu/surface-remote";
import {
  buildSshProbeCommand,
  directAgentDerivation,
  isLocalHost,
  makeSession,
  type SessionState,
  type SshProv,
  sshConnector,
} from "@kolu/surface-remote";
import { TEST_BINARY_CACHE } from "@kolu/surface-remote/agentDerivation.testutil";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const SSH_HOST = process.env.KOLU_E2E_SSH_HOST;
const PADI_DRV = process.env.KOLU_E2E_PADI_DRV;
const PREVIOUS_PADI_STORE = process.env.KOLU_E2E_PREVIOUS_PADI_STORE;
const PREVIOUS_PADI_REF = process.env.KOLU_E2E_PREVIOUS_PADI_REF;
const CURRENT_PADI_STORE = process.env.KOLU_E2E_CURRENT_PADI_STORE;

const present = (v: string | undefined): v is string =>
  v !== undefined && v !== "";

const enabled =
  present(SSH_HOST) &&
  present(PADI_DRV) &&
  present(PREVIOUS_PADI_STORE) &&
  present(PREVIOUS_PADI_REF) &&
  present(CURRENT_PADI_STORE);

if (enabled && isLocalHost(SSH_HOST)) {
  throw new Error(
    `KOLU_E2E_SSH_HOST=${SSH_HOST} is loopback — that runs padi DIRECTLY (no ssh), a false green. Use a non-loopback alias routing to a real sshd.`,
  );
}
if (enabled && process.env.KOLU_E2E_SSH_DESTRUCTIVE_ACK !== "1") {
  throw new Error(
    `REFUSING: the ssh upgrade-window e2e SPAWNS and REAPS padi daemons on '${SSH_HOST}'. ` +
      `Set KOLU_E2E_SSH_DESTRUCTIVE_ACK=1 ONLY if '${SSH_HOST}' is a DISPOSABLE test host (a pu box).`,
  );
}
const describeSsh = enabled ? describe : describe.skip;

const CONNECT_CEILING_MS = 300_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const SSH_RUN_TIMEOUT_MS = 60_000;

async function sshRun(script: string): Promise<string> {
  const { command, args } = buildSshProbeCommand(
    SSH_HOST as string,
    "sh",
    "-c",
    script,
  );
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf-8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: SSH_RUN_TIMEOUT_MS,
    });
    return stdout.trim();
  } catch (err) {
    const killed = (err as { killed?: boolean }).killed === true;
    throw new Error(
      killed
        ? `ssh to ${SSH_HOST} did not return within ${SSH_RUN_TIMEOUT_MS}ms running: ${script}`
        : `ssh to ${SSH_HOST} failed running: ${script}\n${String(err)}`,
      { cause: err },
    );
  }
}

async function remotePadiHome(
  stateRoot: string,
): Promise<{ socketPath: string; gatePath: string }> {
  const xdg = await sshRun('printf %s "$XDG_RUNTIME_DIR"');
  if (xdg === "")
    throw new Error(
      `no $XDG_RUNTIME_DIR on ${SSH_HOST} — padi's rendezvous is keyed to it, so the resident daemon and the front could not be put in contention`,
    );
  const dir = `${xdg}/padi-${padiDigest(stateRoot)}`;
  return { socketPath: `${dir}/padi.sock`, gatePath: `${dir}/padi.pid` };
}

async function remoteGatePid(gatePath: string): Promise<number | null> {
  const out = await sshRun(
    `cat ${gatePath} 2>/dev/null | head -1 | awk '{print $1}'`,
  );
  const pid = Number(out);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function remoteAlive(pid: number): Promise<boolean> {
  return (await sshRun(`kill -0 ${pid} 2>/dev/null && echo yes || echo no`))
    .trim()
    .endsWith("yes");
}

async function waitForResidentDaemon(
  socketPath: string,
  gatePath: string,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = "never probed";
  while (Date.now() < deadline) {
    const up = await sshRun(
      `test -S ${socketPath} && echo sock || echo nosock`,
    );
    if (up.endsWith("sock") && !up.endsWith("nosock")) {
      const pid = await remoteGatePid(gatePath);
      if (pid !== null && (await remoteAlive(pid))) return pid;
      last = `socket present, gate=${pid ?? "absent"}`;
    } else {
      last = "no socket yet";
    }
    await sleep(500);
  }
  throw new Error(
    `the previous-release padi never came up at ${socketPath} on ${SSH_HOST} (${last})`,
  );
}

describeSsh(
  "the remote upgrade window — a previous-epoch padi behind real ssh",
  () => {
    const sessions: { destroy(): void }[] = [];
    const plantedStateRoots: string[] = [];

    afterAll(async () => {
      for (const s of sessions.splice(0)) s.destroy();
      for (const stateRoot of plantedStateRoots.splice(0)) {
        try {
          const { gatePath, socketPath } = await remotePadiHome(stateRoot);
          const pid = await remoteGatePid(gatePath);
          if (pid !== null)
            await sshRun(`kill -TERM ${pid} 2>/dev/null || true`);
          const runtimeDir = socketPath.replace(/\/padi\.sock$/, "");
          const kavalDir = runtimeDir.replace(/\/padi-/, "/kaval-");
          await sshRun(
            `rm -rf ${stateRoot} ${stateRoot}.previous.log ${runtimeDir} ${kavalDir}`,
          );
        } catch (err) {
          console.warn(
            `[upgrade-window] teardown of ${stateRoot} failed: ${err}`,
          );
        }
      }
    });

    it("takes over a resident previous-release padi exactly once and converges in one campaign", async () => {
      assertPreviousReleaseWindow({
        ref: PREVIOUS_PADI_REF as string,
        previousStore: PREVIOUS_PADI_STORE as string,
        currentStore: CURRENT_PADI_STORE as string,
      });
      console.log(
        `[upgrade-window] previous release ${PREVIOUS_PADI_REF} = ${PREVIOUS_PADI_STORE}`,
      );
      console.log(
        `[upgrade-window] current build      = ${CURRENT_PADI_STORE}`,
      );

      const stateRoot = `/tmp/kolu-e2e-upgrade-${randomUUID()}`;
      plantedStateRoots.push(stateRoot);
      const { socketPath, gatePath } = await remotePadiHome(stateRoot);
      console.log(`[upgrade-window] remote state-root ${stateRoot}`);
      console.log(`[upgrade-window] remote rendezvous ${socketPath}`);

      const previousBin = `${PREVIOUS_PADI_STORE}/bin/padi`;
      expect(
        await sshRun(`test -x ${previousBin} && echo yes || echo no`),
      ).toBe("yes");

      const residentLog = `${stateRoot}.previous.log`;
      await sshRun(
        `mkdir -p ${stateRoot}; ` +
          `{ setsid env KOLU_KAVAL_SPAWN=detached ${previousBin} ` +
          `--state-root ${stateRoot} > ${residentLog} 2>&1 < /dev/null & } ` +
          `> /dev/null 2>&1; echo started`,
      );
      const oldPid = await waitForResidentDaemon(socketPath, gatePath, 120_000);
      console.log(
        `[upgrade-window] RESIDENT previous-release padi is up — pid ${oldPid} holds ${gatePath}`,
      );

      const states: SessionState<SshProv>[] = [];
      const remoteLines = new Set<string>();
      const localLines: string[] = [];

      const session = makeSession<AgentClient, SshProv>({
        initialConnection: "probing",
        connectOnce: sshConnector({
          surface: { ...padiSurfaceSibling, group: padiDaemonGroup },
          host: SSH_HOST as string,
          binary: "padi",
          extraArgs: ["--state-root", stateRoot],
          localEnv: {},
          resolveDrvPath: async () =>
            directAgentDerivation(PADI_DRV as string, TEST_BINARY_CACHE),
        }),
        log: collectLogger((l) => {
          localLines.push(l);
          console.log(`[host] ${l}`);
        }),
      });
      sessions.push(session);

      const unsubscribe = session.onState((s) => {
        states.push(s);
        for (const entry of s.log)
          if (entry.source === "remote") remoteLines.add(entry.line);
      });

      const startedAt = Date.now();
      await session.pin();
      session.markConnected();
      const dispatch: SurfaceDispatch | undefined = session.currentDispatch?.();
      if (dispatch === undefined)
        throw new Error("the pinned ssh session exposed no dispatch");
      const combined: PadiDaemonClient = padiClientOver(dispatch);

      const hello = await Effect.runPromise(
        combined.control.surface.core.hello(),
      );
      const connectedMs = Date.now() - startedAt;
      unsubscribe();

      expect(
        isContractVersionCompatible(hello.surfaceVersion, PADI_SURFACE_VERSION),
      ).toBe(true);
      expect(hello.stateRoot).toBe(stateRoot);
      console.log(
        `[upgrade-window] CONNECTED in ${connectedMs}ms — padiSurface=${hello.surfaceVersion} stateRoot=${hello.stateRoot}`,
      );

      const narration = [...remoteLines];
      for (const line of narration) console.log(`[front] ${line}`);

      const tookOver = narration.filter((l) => l.includes("TOOK OVER"));
      expect(
        tookOver.length,
        `expected EXACTLY ONE takeover of the previous-epoch daemon; the front narrated ${tookOver.length}:\n${tookOver.join("\n")}`,
      ).toBe(1);
      const takeover = tookOver[0] as string;
      expect(takeover).toContain(String(oldPid));
      expect(takeover).toMatch(/SIGTERM|SIGKILL/);
      expect(
        narration.some((l) =>
          l.includes("speaks a protocol epoch this supervisor cannot decode"),
        ),
        `the front never named the epoch classification — an unspeakable peer must be classified, not merely dropped:\n${narration.join("\n")}`,
      ).toBe(true);
      expect(takeover).toContain("its own shutdown ran");

      const relayed = narration.filter((l) =>
        l.includes("converged — relaying"),
      );
      expect(
        relayed.length,
        `expected EXACTLY ONE converge-then-relay; got ${relayed.length}:\n${relayed.join("\n")}`,
      ).toBe(1);
      expect(relayed[0]).toContain('"outcome":"recycled"');
      expect(relayed[0]).toContain('"anomaly":null');
      expect(
        narration.some((l) => l.includes("refusing to relay")),
        `the front REFUSED to relay — the upgrade did not complete hands-off:\n${narration.join("\n")}`,
      ).toBe(false);

      expect(
        await remoteAlive(oldPid),
        `the previous-release padi (pid ${oldPid}) is STILL ALIVE — it was not taken over`,
      ).toBe(false);
      const newPid = await remoteGatePid(gatePath);
      expect(newPid, "no pid holds the gate after convergence").not.toBeNull();
      expect(newPid).not.toBe(oldPid);
      expect(await remoteAlive(newPid as number)).toBe(true);
      console.log(
        `[upgrade-window] padi TAKEN OVER on ${SSH_HOST} — ${oldPid} (previous epoch) → ${newPid} (this build)`,
      );

      const phases = states.map((s) => s.phase);
      const campaigns = new Set(states.map((s) => s.campaignEpoch));
      expect(
        phases.includes("failed"),
        `the session went terminal:\n${JSON.stringify(states.filter((s) => s.phase === "failed"))}`,
      ).toBe(false);
      expect(
        campaigns.size,
        `expected ONE campaign (at most one reconnect); saw ${campaigns.size} — campaigns ${[...campaigns].join(",")} over phases ${phases.join("→")}`,
      ).toBeLessThanOrEqual(2);
      const drops = phases.filter((p) => p === "disconnected");
      expect(
        drops.length,
        `the link dropped ${drops.length} times before connecting — the incident's 10s-per-attempt loop:\n${phases.join("→")}`,
      ).toBeLessThanOrEqual(1);
      expect(
        connectedMs,
        `took ${connectedMs}ms to reach connected — a bounded upgrade must not sit in a retry loop`,
      ).toBeLessThan(CONNECT_CEILING_MS);
      console.log(
        `[upgrade-window] one campaign, no terminal verdict — phases ${phases.join("→")} in ${connectedMs}ms`,
      );
    }, 600_000);
  },
);
