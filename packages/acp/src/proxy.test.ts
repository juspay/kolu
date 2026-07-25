/**
 * The "an ACP agent in a tile" done-criteria, one test each.
 *
 * Every test drives the real bins: a spawned `acp-proxy`, a spawned adapter
 * behind it, a real unix socket, and the official ACP client library on the
 * far end. Nothing is shimmed in-process, because the properties being pinned
 * — a process dying mid-turn, a cancel that the agent ignores — only exist
 * between real processes.
 *
 * The adapter is a parameter. The suite runs over two argvs of the same
 * scripted fake, which is how "nothing in the package is shaped like one
 * vendor's agent" becomes something the tests check rather than something the
 * README claims. The real second adapter (`codex-acp`) is covered by the
 * out-of-band smoke described in the package README.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import type { PromptResponse } from "@zed-industries/agent-client-protocol";
import { afterEach, describe, expect, it } from "vitest";
import { CANCEL_GRACE_MS } from "./adapter.ts";
import { connectToProxy } from "./connect.ts";

/** tsx's ESM loader, resolved from THIS package — pnpm does not hoist it. */
const TSX_LOADER = pathToFileURL(
  createRequire(import.meta.url).resolve("tsx"),
).href;
const here = dirname(fileURLToPath(import.meta.url));
const PROXY = join(here, "proxy.ts");
const FAKE_ADAPTER = join(here, "fakeAdapter.fixture.ts");

/** Two argvs of the same fake — the parameter that proves agent-agnosticism. */
const ADAPTER_STYLES = [
  { name: "terse", args: [] as string[] },
  { name: "verbose", args: ["--verbose"] },
];

/** Long enough for a spawn plus a handshake on a loaded CI box. */
const WAIT_TIMEOUT_MS = 15_000;

interface RunningProxy {
  socketPath: string;
  stdout(): string;
  waitFor(predicate: (stdout: string) => boolean, what: string): Promise<void>;
  adapterPids(): number[];
  /** How many times an adapter has become *promptable*. Spawning is not the
   *  same signal: a prompt sent between spawn and handshake is refused. */
  readyCount(): number;
  stop(): void;
}

const running: RunningProxy[] = [];
afterEach(() => {
  while (running.length) running.pop()?.stop();
});

/** Launch the proxy without waiting for it to serve — for the cases where it
 *  is supposed to fail instead. Resolves with the exit code and its output. */
async function runProxyToExit(
  adapterArgs: string[],
  options: { command?: string } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  assertDaemonSpawnAllowed("the acp-proxy bin and its adapter");
  const runtimeDir = mkdtempSync(join(tmpdir(), "acp-"));
  const child = spawn(
    process.execPath,
    proxyArgv(adapterArgs, options.command),
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (c) => {
    stdout += String(c);
  });
  child.stderr?.on("data", (c) => {
    stderr += String(c);
  });
  const code = await new Promise<number | null>((resolve) =>
    child.once("exit", resolve),
  );
  rmSync(runtimeDir, { recursive: true, force: true });
  return { code, stdout, stderr };
}

function proxyArgv(adapterArgs: string[], command?: string): string[] {
  const adapter =
    command === undefined
      ? [process.execPath, "--import", TSX_LOADER, FAKE_ADAPTER]
      : [command];
  return [
    "--import",
    TSX_LOADER,
    PROXY,
    "--id",
    "test",
    "--",
    ...adapter,
    ...adapterArgs,
  ];
}

async function startProxy(adapterArgs: string[]): Promise<RunningProxy> {
  assertDaemonSpawnAllowed("the acp-proxy bin and its adapter");
  // A private XDG_RUNTIME_DIR keeps the socket off the real one and keeps the
  // path short enough for the ~108-byte sockaddr_un limit.
  const runtimeDir = mkdtempSync(join(tmpdir(), "acp-"));
  const child: ChildProcess = spawn(process.execPath, proxyArgv(adapterArgs), {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const proxy: RunningProxy = {
    socketPath: join(runtimeDir, "kolu", "acp-test.sock"),
    stdout: () => stdout,
    waitFor: async (predicate, what) => {
      const deadline = Date.now() + WAIT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (predicate(stdout)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(
        `timed out waiting for ${what}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
      );
    },
    adapterPids: () =>
      [...stdout.matchAll(/\(pid (\d+)\)/g)].map((m) => Number(m[1])),
    readyCount: () => [...stdout.matchAll(/⎯ adapter ready · /g)].length,
    stop: () => {
      child.kill("SIGKILL");
      rmSync(runtimeDir, { recursive: true, force: true });
    },
  };
  running.push(proxy);
  await proxy.waitFor((out) => out.includes("⎯ listening · "), "the socket");
  return proxy;
}

interface TestClient {
  prompt(text: string): Promise<PromptResponse>;
  cancel(): void;
  /** Agent message text seen so far. */
  reply(): string;
  /** Prompt text seen so far — what an *observer* client learns was asked. */
  asked(): string;
  close(): void;
}

/** A test client over the package own plug, so the suite exercises the same
 *  connection rules a real consumer gets rather than a parallel hand-roll. */
async function connectClient(socketPath: string): Promise<TestClient> {
  const client = await connectToProxy(socketPath);
  let reply = "";
  let asked = "";
  client.onUpdate((update) => {
    if (
      update.sessionUpdate === "agent_message_chunk" &&
      update.content.type === "text"
    ) {
      reply += update.content.text;
    }
    if (
      update.sessionUpdate === "user_message_chunk" &&
      update.content.type === "text"
    ) {
      asked += update.content.text;
    }
  });
  return {
    prompt: (text) => client.prompt(text),
    cancel: () => client.cancel(),
    reply: () => reply,
    asked: () => asked,
    close: () => client.close(),
  };
}

/** Every line the tile shows is one of these four speakers. */
const TRANSCRIPT_MARKERS = ["▶", "◀", "●", "⎯"];

describeDaemon("acp-proxy, end to end over a real socket", () => {
  for (const style of ADAPTER_STYLES) {
    describe(`adapter argv: fake ${style.name}`, () => {
      it("carries a prompt to the adapter and streams the reply back", async () => {
        const proxy = await startProxy(style.args);
        const client = await connectClient(proxy.socketPath);

        const response = await client.prompt("hello");

        expect(response.stopReason).toBe("end_turn");
        expect(client.reply()).toContain("echo: hello");
      });

      it("renders the tile transcript from frames alone", async () => {
        const proxy = await startProxy(style.args);
        const client = await connectClient(proxy.socketPath);
        await client.prompt("hello");
        await proxy.waitFor(
          (out) => out.includes("● turn end"),
          "the turn to end",
        );

        const out = proxy.stdout();
        // Each of these is derived from one frame or one method call.
        expect(out).toContain('▶ session/prompt · "hello"');
        expect(out).toContain("◀ agent_message_chunk · ");
        expect(out).toContain("echo: hello");
        expect(out).toContain("◀ tool_call · execute — echo hello");
        expect(out).toContain("auto-answered Allow once");
        expect(out).toContain("◀ tool_call_update · completed");
        expect(out).toContain("● turn end · stopReason: end_turn");

        // Nothing else: a line the protocol did not produce would have to come
        // from somewhere the proxy is not allowed to look.
        const strays = out
          .split("\n")
          .filter((line) => line.length > 0)
          .filter((line) => !TRANSCRIPT_MARKERS.includes(line[0] ?? ""));
        expect(strays).toEqual([]);
      });

      it("respawns the adapter after it dies mid-turn, and the next prompt works", async () => {
        const proxy = await startProxy(style.args);
        const client = await connectClient(proxy.socketPath);

        // `hang` streams and then goes quiet, so the turn is provably still
        // running when the adapter is killed from outside.
        const hung = client.prompt("hang");
        // Claim the rejection before provoking it: the turn fails the instant
        // the adapter dies, and an unhandled rejection would fail the run.
        const failed = expect(hung).rejects.toThrow();
        await proxy.waitFor(
          (out) => out.includes("streaming, then silence"),
          "the turn to start",
        );
        const [adapterPid] = proxy.adapterPids();
        expect(adapterPid).toBeGreaterThan(0);
        process.kill(adapterPid as number, "SIGKILL");

        await failed;
        await proxy.waitFor(
          () => proxy.readyCount() === 2,
          "the adapter to respawn",
        );

        const response = await client.prompt("after the kill");
        expect(response.stopReason).toBe("end_turn");
        expect(client.reply()).toContain("echo: after the kill");
      });

      it("respawns the adapter after it exits on its own mid-turn", async () => {
        const proxy = await startProxy(style.args);
        const client = await connectClient(proxy.socketPath);

        await expect(client.prompt("crash")).rejects.toThrow();
        await proxy.waitFor(
          () => proxy.readyCount() === 2,
          "the adapter to respawn",
        );

        const response = await client.prompt("after the crash");
        expect(response.stopReason).toBe("end_turn");
        expect(client.reply()).toContain("echo: after the crash");
      });

      it("ends a turn the adapter cancels cleanly, without replacing it", async () => {
        const proxy = await startProxy(style.args);
        const client = await connectClient(proxy.socketPath);

        const slow = client.prompt("slow");
        await proxy.waitFor(
          (out) => out.includes("working, cancel me"),
          "the turn to start",
        );
        client.cancel();

        expect((await slow).stopReason).toBe("cancelled");
        expect(proxy.stdout()).toContain("▶ session/cancel");
        // An agent that honoured the cancel is healthy; killing it would throw
        // away a working process and the session with it.
        expect(proxy.stdout()).not.toContain("cancel grace expired");
        expect(proxy.adapterPids()).toHaveLength(1);
      });

      it("kills and replaces an adapter that ignores the cancel", async () => {
        const proxy = await startProxy(style.args);
        const client = await connectClient(proxy.socketPath);

        const hung = client.prompt("hang");
        await proxy.waitFor(
          (out) => out.includes("streaming, then silence"),
          "the turn to start",
        );
        const startedAt = Date.now();
        client.cancel();

        expect((await hung).stopReason).toBe("cancelled");
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(CANCEL_GRACE_MS);
        expect(proxy.stdout()).toContain("cancel grace expired");

        await proxy.waitFor(
          () => proxy.readyCount() === 2,
          "the adapter to respawn",
        );
        const response = await client.prompt("after the cancel");
        expect(response.stopReason).toBe("end_turn");
      });
    });
  }

  it("answers a permission request by kind, never by option id", async () => {
    const proxy = await startProxy(["--decoy-permission"]);
    const client = await connectClient(proxy.socketPath);

    await client.prompt("hello");

    // The fake grades the choice: `completed` only if the option the proxy
    // picked was the one whose *kind* is allow_once. Picking the first option,
    // or the one whose id reads `allow-once`, selects allow_always and fails.
    expect(proxy.stdout()).toContain("◀ tool_call_update · completed");
    expect(proxy.stdout()).toContain("auto-answered Just this once");
  });

  it("refuses a second client's prompt while a turn is running", async () => {
    const proxy = await startProxy([]);
    const first = await connectClient(proxy.socketPath);
    const second = await connectClient(proxy.socketPath);

    const slow = first.prompt("slow");
    await proxy.waitFor(
      (out) => out.includes("working, cancel me"),
      "the turn to start",
    );

    // The reason travels in the JSON-RPC error's `data`; the `message` is the
    // generic code name, so asserting on it would pin nothing.
    await expect(second.prompt("hello")).rejects.toMatchObject({
      data: { reason: expect.stringContaining("already in progress") },
    });

    first.cancel();
    expect((await slow).stopReason).toBe("cancelled");
  });

  it("fails fast when the adapter dies during the handshake", async () => {
    // The ACP library never rejects a request when its stream ends, so a child
    // that dies mid-handshake looks exactly like a slow one. Before the
    // generation's death was wired to the request, this sat for the full 60s
    // handshake timeout — never opening the socket — and then killed whatever
    // had respawned in the meantime.
    const startedAt = Date.now();
    const { code, stdout, stderr } = await runProxyToExit(["--die-on-boot"]);

    expect(code).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(20_000);
    expect(stderr).toMatch(/adapter exited/);
    // It never claimed to be serving: no client can have connected to a proxy
    // whose agent never came up.
    expect(stdout).not.toContain("⎯ listening · ");
  });

  it("paces respawns and gives up loudly when the adapter never stays up", async () => {
    // Unpaced, an adapter that exits on boot was respawned as fast as the
    // kernel allowed — measured at ~230 processes a second, indefinitely.
    const { code, stdout, stderr } = await runProxyToExit(["--die-when-ready"]);

    expect(code).toBe(1);
    expect(stderr).toMatch(/failed \d+ times in a row/);

    const attempts = [
      ...stdout.matchAll(/respawning adapter · attempt (\d+)/g),
    ];
    // A handful of paced attempts, not a spin: bounded by the give-up cap.
    expect(attempts.length).toBeLessThanOrEqual(6);
    expect(attempts.map((m) => Number(m[1]))).toEqual(
      attempts.map((_m, i) => i + 1),
    );
    // And the wait grows rather than staying at zero.
    const delays = [...stdout.matchAll(/attempt \d+ in (\d+)ms/g)].map((m) =>
      Number(m[1]),
    );
    expect(delays.length).toBeGreaterThan(1);
    expect(delays[delays.length - 1]).toBeGreaterThan(delays[0] as number);
  });

  it("streams the session to every attached client at once", async () => {
    const proxy = await startProxy([]);
    const driver = await connectClient(proxy.socketPath);
    const observer = await connectClient(proxy.socketPath);

    await driver.prompt("hello");

    // The tile is one attached client among several; an observer that joined
    // separately sees the same turn, which is what lets a debugging `acp-chat`
    // sit beside pesu on the same session.
    expect(observer.reply()).toContain("echo: hello");
    // And the question, not just the answer. Broadcasting only the agent's
    // half left a bystander rendering replies to prompts it never saw.
    expect(observer.asked()).toContain("hello");
  });

  it("keeps replacing an adapter that dies during a respawn's handshake", async () => {
    // The wedge both lens reviews found independently. A replacement dying
    // mid-handshake used to have its rescheduling swallowed by the very guard
    // that marked a respawn in flight — leaving the proxy listening with no
    // adapter, no retry and no fatal, answering every prompt "not ready".
    const { code, stdout, stderr } = await runProxyToExit(["--die-on-respawn"]);

    // It gets to serve once, then every replacement dies in its handshake.
    expect(stdout).toContain("⎯ adapter ready · ");
    // The give-up cap must be reachable on this path, not just the easy one.
    expect(code).toBe(1);
    expect(stderr).toMatch(/failed \d+ times in a row/);
    const attempts = [
      ...stdout.matchAll(/respawning adapter · attempt (\d+)/g),
    ];
    expect(attempts.map((m) => Number(m[1]))).toEqual(
      attempts.map((_m, i) => i + 1),
    );
  });

  it("gives up when the adapter command does not exist", async () => {
    // Node emits `error` and NEVER `exit` for a spawn that cannot start, so an
    // accounting hung off `exit` alone never advances the failure streak — the
    // proxy stays up forever with no adapter behind it.
    const { code, stdout, stderr } = await runProxyToExit([], {
      command: join(here, "no-such-adapter-binary"),
    });

    expect(stdout).toMatch(/adapter failed to start/);
    expect(code).toBe(1);
    expect(stderr).toMatch(/failed \d+ times in a row|ENOENT/);
  });
});
