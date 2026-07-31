/**
 * Env-layering parity guard for the spawn-input composition.
 *
 * The whole inversion's "byte-identical to the pre-inversion daemon" claim
 * funnels through `composeSpawnInput`'s three-layer env merge, least → most
 * authoritative:
 *   1. cleanEnv()        — parent env passthrough (sentinel COLORTERM here).
 *   2. koluIdentityEnv() — kolu's identity vars (stomp parent).
 *   3. plan.env          — per-PTY overrides (ZDOTDIR for zsh).
 *
 * `composeSpawnInput` is the PURE half (it takes `system.info` as an argument),
 * so these lock the precedence without a live daemon — a future edit that
 * reorders the two `Object.assign`s (letting identity vars stomp ZDOTDIR, or the
 * parent stomp identity) fails here instead of silently shipping. The golden
 * `prepareShellInit` tests in kolu-pty's shell.test.ts cover the plan itself.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MIRROR_SCROLLBACK, type PtyHostSystemInfo } from "kaval";
// The client's VISIBLE xterm scrollback (kolu-common/config `DEFAULT_SCROLLBACK`).
// Inlined, not imported: padi's dependency cone must not reach into the app
// (kolu-common) — the seal's fifth arm enforces it. This test asserts padi's
// spawned MIRROR scrollback is decoupled from (and smaller than) that visible
// value; the literal below is the app-side number it compares against.
const CLIENT_VISIBLE_SCROLLBACK = 50_000;
import { AGENT_TOOLS_BAKE_ENV, TERMINAL_TOOLS_PATH_ENV } from "kolu-pty";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  composeSpawnInput,
  setSpawnServerVersion,
  type TerminalEnvSpec,
} from "./index.ts";

// The spawned PTY's identity version is boot-injected; these env-layering tests
// don't assert on it, but `composeSpawnInput` now fail-fasts on a read before the
// set, so inject a version once for the whole file. The read-before-set crash is
// pinned separately in `spawnServerVersion.test.ts`.
setSpawnServerVersion("9.9.9-test");

const RC_DIR = mkdtempSync(join(tmpdir(), "spawn-input-rc-"));

/** A stand-in for the socket this daemon serves on (`getLocalSocketPath()`
 *  in production). Passed as data so the composer stays pure. */
const KAVAL_SOCK = "/tmp/kaval-7692-501/pty-host.sock";

/** The daemon's own facts as one value, with the members a given case doesn't
 *  assert on filled in. `toolsPath: []` is the honest "this daemon baked none" —
 *  the field is required, so there is exactly one spelling of that state. */
function spec(over: Partial<TerminalEnvSpec> = {}): TerminalEnvSpec {
  return {
    kavalSocket: KAVAL_SOCK,
    toolsPath: [],
    serverVersion: "9.9.9-test",
    ...over,
  };
}

/** A host-facts fixture standing in for the daemon's `system.info`. */
function info(over: Partial<PtyHostSystemInfo> = {}): PtyHostSystemInfo {
  return {
    shell: "/bin/sh",
    home: "/home/test",
    platform: "linux",
    rcDir: RC_DIR,
    ...over,
  } as PtyHostSystemInfo;
}

describe("composeSpawnInput env layering", () => {
  let savedShell: string | undefined;
  let savedColorterm: string | undefined;
  let savedKavalSocket: string | undefined;
  let savedTerminalId: string | undefined;

  beforeEach(() => {
    savedShell = process.env.SHELL;
    savedColorterm = process.env.COLORTERM;
    savedKavalSocket = process.env.KAVAL_SOCKET;
    savedTerminalId = process.env.KAVAL_TERMINAL_ID;
  });

  afterEach(() => {
    restore("SHELL", savedShell);
    restore("COLORTERM", savedColorterm);
    // Restore rather than delete: a worker launched from a kolu-owned terminal
    // legitimately starts with KAVAL_SOCKET set, so unconditionally deleting it
    // would corrupt the env for the rest of the worker.
    restore("KAVAL_SOCKET", savedKavalSocket);
    // Same reason as KAVAL_SOCKET: this worker may itself run inside a kolu
    // terminal, so it legitimately carries KAVAL_TERMINAL_ID — restore, not delete.
    restore("KAVAL_TERMINAL_ID", savedTerminalId);
  });

  it("koluIdentityEnv overrides a same-named cleanEnv (parent) key", () => {
    // cleanEnv() passes process.env through, so a parent COLORTERM is in the
    // base layer. koluIdentityEnv layers COLORTERM=truecolor on top — the
    // identity assertion must win over whatever the parent happened to carry.
    process.env.COLORTERM = "PARENT_SENTINEL";
    const input = composeSpawnInput({ id: "T-colorterm" }, info(), spec());
    expect(input.env.COLORTERM).toBe("truecolor");
  });

  it("plan.env (ZDOTDIR) survives over both cleanEnv and koluIdentityEnv", () => {
    // Force a zsh shell so prepareShellInit returns a ZDOTDIR override; it is
    // the most-authoritative layer (applied last) and must reach the wire
    // unclobbered — the bytes that make the zsh wrapper rcfile load.
    process.env.SHELL = "/bin/zsh";
    const id = "T-zdotdir";
    const input = composeSpawnInput({ id }, info(), spec());
    expect(input.argv[0]).toBe("/bin/zsh");
    expect(input.env.ZDOTDIR).toBe(join(RC_DIR, `zdotdir-${id}`));
  });

  it("local env SHELL wins over system.info.shell (the local-host boundary)", () => {
    // Boundary pin: today the host IS this process, so cleanEnv()'s local SHELL
    // is authoritative and system.info.shell is only a fallback. A future remote
    // host (R-2) must invert this — host facts winning over the server's env —
    // so locking the current local-wins ordering makes that change deliberate.
    process.env.SHELL = "/bin/zsh";
    const input = composeSpawnInput(
      { id: "T-local-shell" },
      info({ shell: "/bin/dash" }),
      spec(),
    );
    expect(input.argv[0]).toBe("/bin/zsh");
  });

  it("stamps KAVAL_SOCKET with the daemon's own socket (the $TMUX convention)", () => {
    // The socket THIS kaval serves on is stamped into every terminal so a process
    // inside (an agent driving its siblings) can reach its owning daemon without
    // scanning /tmp — and, on macOS with $XDG_RUNTIME_DIR unset, without guessing
    // the port-namespaced path. It's passed as data, so the composer stays pure.
    const input = composeSpawnInput({ id: "T-kaval-socket" }, info(), spec());
    expect(input.env.KAVAL_SOCKET).toBe(KAVAL_SOCK);
  });

  it("KAVAL_SOCKET is not clobbered by a same-named parent env key", () => {
    // A stray KAVAL_SOCKET in the parent env (e.g. this terminal was itself
    // spawned by an outer kaval) must be overwritten by THIS daemon's socket —
    // the child is owned by us, not the outer daemon. cleanEnv passes it through
    // (KAVAL_* isn't stripped wholesale), so the stamp has to win.
    // afterEach restores KAVAL_SOCKET to its saved value, so no local cleanup.
    process.env.KAVAL_SOCKET = "/tmp/kaval-OUTER-501/pty-host.sock";
    const input = composeSpawnInput({ id: "T-nested" }, info(), spec());
    expect(input.env.KAVAL_SOCKET).toBe(KAVAL_SOCK);
  });

  it("stamps PADI_SOCKET with padi's own serving socket (the $KAVAL_SOCKET twin)", () => {
    // padi's OWN socket is stamped so a `padi-tui` running INSIDE the terminal
    // reaches the padi that owns it flag-free (the /kolu agent-drives-agent loop
    // runs `padi-tui wait` with no --socket). Passed as data, keeping the composer
    // pure — buildTerminalSpawnInput reads it from getPadiServeSocketPath() at boot.
    const PADI_SOCK = "/run/user/1000/padi-abc123/padi.sock";
    const input = composeSpawnInput(
      { id: "T-padi-socket" },
      info(),
      spec({ padiSocket: PADI_SOCK }),
    );
    expect(input.env.PADI_SOCKET).toBe(PADI_SOCK);
  });

  it("omits PADI_SOCKET when padi's serving socket is unknown (autodiscovery covers it)", () => {
    // Unlike the REQUIRED kaval locator, an absent padi socket just omits the
    // hint and padi-tui autodiscovers — so the composer stamps it only when known
    // (an optional field of the spec), never a bare/empty PADI_SOCKET.
    const input = composeSpawnInput({ id: "T-no-padi" }, info(), spec());
    expect(input.env.PADI_SOCKET).toBeUndefined();
  });

  it("stamps KAVAL_TERMINAL_ID with the terminal's own id", () => {
    // A process inside the terminal reads its OWN id from the env — the
    // self-knowledge twin of KAVAL_SOCKET (which names the daemon). Stamped from
    // args.id, the same value that names the wire `id` and the rcfile.
    const input = composeSpawnInput({ id: "T-self-id" }, info(), spec());
    expect(input.env.KAVAL_TERMINAL_ID).toBe("T-self-id");
    expect(input.env.KAVAL_TERMINAL_ID).toBe(input.id);
  });

  it("re-stamps KAVAL_TERMINAL_ID over an inherited (outer) one — nested terminals get a fresh id", () => {
    // A nested kolu (this server spawned inside a kolu terminal) inherits the
    // OUTER terminal's KAVAL_TERMINAL_ID in process.env. cleanEnv passes it
    // through (KAVAL_* isn't stripped wholesale), so the composer's direct stamp
    // must overwrite it — each terminal ends up with its own, never the parent's
    // (the same non-clobber property the KAVAL_SOCKET test pins).
    // afterEach restores KAVAL_TERMINAL_ID to its saved value, so no local cleanup.
    process.env.KAVAL_TERMINAL_ID = "T-OUTER";
    const input = composeSpawnInput({ id: "T-inner" }, info(), spec());
    expect(input.env.KAVAL_TERMINAL_ID).toBe("T-inner");
  });

  it("resolves a real shell when the local env omits SHELL", () => {
    // With SHELL absent from the parent env, the composition still resolves a
    // real absolute shell rather than crashing — the same path a systemd user
    // service (no SHELL) exercises. cleanEnv() backstops SHELL from /etc/passwd,
    // and system.info.shell is the final fallback when even that is empty, so
    // the resolved shell is always a real path.
    delete process.env.SHELL;
    const input = composeSpawnInput(
      { id: "T-fallback-shell" },
      info({ shell: "/bin/bash" }),
      spec(),
    );
    expect(input.argv[0]?.startsWith("/")).toBe(true);
  });
});

describe("composeSpawnInput agent toolchain (PATH injection)", () => {
  const TOOLS = "/nix/store/aaa-padi/bin";
  const TOOLS2 = "/nix/store/bbb-kolu-agent-tools/bin";

  // The dedupe case seeds process.env.PATH; restore it so the rest of the worker
  // (and any sibling suite) keeps the PATH it was launched with.
  let savedPath: string | undefined;
  beforeEach(() => {
    savedPath = process.env.PATH;
  });
  afterEach(() => {
    restore("PATH", savedPath);
  });

  it("prepends the tool dirs to PATH so kolu's own CLIs resolve first", () => {
    // The point of the whole feature: a terminal on a REMOTE host has no
    // kaval-tui / padi-tui / kolu on its PATH (nothing is installed there — the
    // closure is nix-copied per dial), so an agent inside it cannot drive its
    // siblings or reach the MCP face. Prepending — not appending — is what makes
    // the daemon's OWN build win a name collision with an older one the user
    // happens to have installed.
    const input = composeSpawnInput(
      { id: "T-tools" },
      info(),
      spec({ toolsPath: [TOOLS, TOOLS2] }),
    );
    const entries = (input.env.PATH ?? "").split(":");
    expect(entries[0]).toBe(TOOLS);
    expect(entries[1]).toBe(TOOLS2);
  });

  it("keeps the user's own PATH — the toolchain merges, it does not replace", () => {
    // This is the one env layer that must NOT stomp what came before: every
    // command the user already had must still resolve, or we'd have "fixed" the
    // agent's tooling by breaking the terminal.
    const before = (
      composeSpawnInput({ id: "T-before" }, info(), spec()).env.PATH ?? ""
    ).split(":");
    const after = (
      composeSpawnInput({ id: "T-after" }, info(), spec({ toolsPath: [TOOLS] }))
        .env.PATH ?? ""
    ).split(":");
    for (const entry of before) expect(after).toContain(entry);
  });

  it("stamps KOLU_TERMINAL_TOOLS_PATH so the rcfile can re-assert after dotfile replay", () => {
    // The env var is not decoration: the wrapper rcfile reads it to put the dirs
    // back on PATH AFTER the user's ~/.bashrc runs, since an absolute
    // `export PATH=…` there would otherwise silently drop them. Spawn env alone
    // is not a guarantee — this pins the second half of the pair.
    const input = composeSpawnInput(
      { id: "T-stamp" },
      info(),
      spec({ toolsPath: [TOOLS, TOOLS2] }),
    );
    expect(input.env[TERMINAL_TOOLS_PATH_ENV]).toBe(`${TOOLS}:${TOOLS2}`);
  });

  it("never stamps the BAKE name into a terminal", () => {
    // The two names are what make build skew unspellable: a kolu launched from
    // inside this terminal must find NO bake to inherit, so it cannot hand a
    // foreign build's tools to the terminals it goes on to spawn. If this ever
    // goes green with the bake name present, the daemon/tool skew is back.
    const input = composeSpawnInput(
      { id: "T-no-bake" },
      info(),
      spec({ toolsPath: [TOOLS, TOOLS2] }),
    );
    expect(input.env[AGENT_TOOLS_BAKE_ENV]).toBeUndefined();
  });

  it("does not duplicate a dir already on PATH (a re-spawn can't grow it)", () => {
    // Terminals are durable and nest; without the dedupe every re-spawn or nested
    // kolu would push another copy onto PATH forever.
    process.env.PATH = `${TOOLS}:/usr/bin`;
    const input = composeSpawnInput(
      { id: "T-dedupe" },
      info(),
      spec({ toolsPath: [TOOLS] }),
    );
    const hits = (input.env.PATH ?? "")
      .split(":")
      .filter((e) => e === TOOLS).length;
    expect(hits).toBe(1);
  });

  it("leaves PATH and the stamp untouched when no toolchain is baked (from-source)", () => {
    // A `just dev` / e2e padi has no nix wrapper, so it has no toolchain to
    // inject. That is explicit absence, not a default to guess at: the spawn env
    // must be byte-identical to what it is today, never a partial/empty stamp.
    // ONE case, not two: `toolsPath` is required with `[]` as the only spelling
    // of "none", so there is no second encoding to reconcile against.
    const noPath = process.env.PATH;
    const empty = composeSpawnInput(
      { id: "T-bare" },
      info(),
      spec({ toolsPath: [] }),
    );
    expect(empty.env[TERMINAL_TOOLS_PATH_ENV]).toBeUndefined();
    expect(empty.env.PATH).toBe(noPath);
  });
});

describe("composeSpawnInput mirror scrollback (the OOM-fix decouple)", () => {
  it("sends the small server-mirror scrollback, decoupled from the client's", () => {
    // The server tells kaval how deep a per-terminal headless mirror to keep.
    // It must send kaval's small `DEFAULT_MIRROR_SCROLLBACK`, NOT the client's
    // visible `DEFAULT_SCROLLBACK` — the conflated 50K mirror × unbounded live
    // terminals was the production V8-heap OOM (see kaval-heap-oom.mdx). Red
    // before the decouple (the input carried DEFAULT_SCROLLBACK).
    const input = composeSpawnInput({ id: "T-mirror" }, info(), spec());
    expect(input.scrollback).toBe(DEFAULT_MIRROR_SCROLLBACK);
    expect(input.scrollback).toBeLessThan(CLIENT_VISIBLE_SCROLLBACK);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
