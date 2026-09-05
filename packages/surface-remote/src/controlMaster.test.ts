/**
 * Coverage for the ssh ControlMaster opt construction (`controlOptPairs`):
 * the path is the kolu-private `%C` socket (never `~/.ssh`) KEYED BY the dial's
 * keepalive policy, the control dir is created `0700` once (the effect is
 * policy-INDEPENDENT, so it is memoized in one slot while the path stays a pure
 * per-policy computation), and any setup we cannot name a `ControlPath` for — a
 * non-private dir, a dir that is not literal path text (whitespace, ssh
 * expansion syntax, a quote), or an expanded path too long for `sun_path` —
 * degrades to an explicit refusal to multiplex rather than corrupting the ssh
 * options. All FS work is confined to a fresh `/tmp` subdir per test; no ssh /
 * nix is spawned.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetControlMemo, controlOptPairs } from "./controlMaster";
import {
  DEFAULT_SSH_KEEPALIVE,
  renderableKeepalive,
  type SshKeepalive,
  sshKeepalive,
} from "./keepalive";

/** A CI-shaped policy: ride out a five-minute blip instead of killing a lane. */
const CI_KEEPALIVE: SshKeepalive = sshKeepalive(30, 10);

const tmpDirs: string[] = [];
/** A fresh runtime dir under a SHORT root — deliberately `/tmp` and not
 *  `os.tmpdir()`, because the expanded `ControlPath` must fit a unix socket
 *  address (see `controlPathFits`) and macOS's `os.tmpdir()` is a ~49-byte
 *  `/var/folders/…` path that would push it over on its own. A real
 *  `$XDG_RUNTIME_DIR` is short (`/run/user/1000`); the fixture should be too, or
 *  it tests the length guard instead of what it means to. */
function freshXdg(): string {
  const dir = mkdtempSync(join("/tmp", "kolu-ssh-test-"));
  tmpDirs.push(dir);
  return dir;
}
/** A runtime dir of a given literal name under `/tmp`, for the length cases.
 *  Not created here — `ensureControlDir` creates it `0700`, which is what the
 *  guard has to run against. */
function namedXdg(name: string): string {
  const dir = join("/tmp", name);
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  __resetControlMemo();
});
afterEach(() => {
  __resetControlMemo();
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0))
    rmSync(d, { recursive: true, force: true });
});

/** `controlOptPairs` at a policy, reached the ONLY way `host.ts` reaches it:
 *  through the capture boundary. `controlOptPairs` takes the `KeepalivePlan`
 *  `renderableKeepalive` read out of a policy, never the policy object — the
 *  socket name has to be spelled from the same two numbers the `ServerAlive*`
 *  options were. */
const pairsFor = (
  keepalive: SshKeepalive = DEFAULT_SSH_KEEPALIVE,
): readonly (readonly [string, string])[] =>
  controlOptPairs(renderableKeepalive(keepalive));

/** The `ControlPath` value out of the rendered pairs (undefined if absent). */
function controlPathValue(
  keepalive: SshKeepalive = DEFAULT_SSH_KEEPALIVE,
): string | undefined {
  return pairsFor(keepalive).find(([k]) => k === "ControlPath")?.[1];
}
function optMap(): Record<string, string> {
  return Object.fromEntries(pairsFor().map(([k, v]) => [k, v]));
}

describe("controlOptPairs path shape", () => {
  it("is the kolu-private %C socket under the runtime dir, never ~/.ssh", () => {
    const xdg = freshXdg();
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    __resetControlMemo();
    const path = controlPathValue();
    expect(path).toBeDefined();
    const p = path as string;
    // ssh expands %C per host at connect; the suffix keys the master by policy.
    expect(p.endsWith("/%C-10x3")).toBe(true);
    expect(p).toContain("kolu-ssh");
    expect(p.startsWith(xdg)).toBe(true);
    expect(p).not.toContain(".ssh"); // never the user's ssh-config dir
    expect(/\s/.test(p)).toBe(false); // NIX_SSHOPTS word-split contract
  });

  it("carries ControlMaster=auto and a cross-invocation ControlPersist", () => {
    vi.stubEnv("XDG_RUNTIME_DIR", freshXdg());
    __resetControlMemo();
    const opts = optMap();
    expect(opts.ControlMaster).toBe("auto");
    expect(opts.ControlPersist).toBe("10m");
  });

  it("agrees on one path: the mkdir'd dir is dirname(ControlPath), token-free", () => {
    vi.stubEnv("XDG_RUNTIME_DIR", freshXdg());
    __resetControlMemo();
    const path = controlPathValue() as string;
    const dir = dirname(path);
    expect(dir).not.toContain("%C"); // the real dir has no ssh token
    // single-source-of-truth: that exact dir is the one that got created.
    expect(statSync(dir).isDirectory()).toBe(true);
  });

  // The load-bearing property behind the per-dial keepalive policy: OpenSSH
  // applies ServerAlive* from whichever process OPENED the master, and every
  // later ssh riding that socket silently inherits it. So two policies must
  // never name the same socket — otherwise a CI dial asking for a five-minute
  // tolerance would quietly get an interactive dial's 30s, with correct argv.
  it("keys the socket by policy, so two policies never share one master", () => {
    vi.stubEnv("XDG_RUNTIME_DIR", freshXdg());
    __resetControlMemo();
    const interactive = controlPathValue(DEFAULT_SSH_KEEPALIVE) as string;
    const ci = controlPathValue(CI_KEEPALIVE) as string;
    expect(ci).not.toBe(interactive);
    expect(ci.endsWith("/%C-30x10")).toBe(true);
    // Both still ride the ONE private control dir (which is what gets mkdir'd).
    expect(dirname(ci)).toBe(dirname(interactive));
    expect(/\s/.test(ci)).toBe(false); // NIX_SSHOPTS word-split contract
  });
});

describe("controlOptPairs ensure-dir", () => {
  it("creates the control dir 0700 ONCE, then renders every policy purely", () => {
    const xdg = freshXdg();
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    __resetControlMemo();
    const dir = join(xdg, "kolu-ssh");
    const first = pairsFor();
    if (process.getuid !== undefined) {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
    // The mkdir + lstat is the only EFFECT here, and it does not vary with the
    // policy (every policy's socket sits in this one dir — asserted above). So
    // it is memoized in ONE slot rather than once per policy: delete the dir
    // and neither a second render NOR a second policy recreates it.
    rmSync(dir, { recursive: true, force: true });
    expect(pairsFor()).toEqual(first);
    expect(existsSync(dir)).toBe(false);
    const ci = pairsFor(CI_KEEPALIVE);
    expect(existsSync(dir)).toBe(false);
    // …while the VALUE is pure and still per-policy.
    expect(ci).not.toEqual(first);
  });

  it("refuses multiplexing (never silence) when the control dir is not owner-only", () => {
    if (process.getuid === undefined) return; // no uid semantics — skip
    const xdg = freshXdg();
    // Pre-create the computed control dir with group/other bits set.
    // chmod (not mkdir mode) so the loose perms survive any test umask.
    const dir = join(xdg, "kolu-ssh");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    __resetControlMemo();
    expect(pairsFor()).toEqual([
      ["ControlMaster", "no"],
      ["ControlPath", "none"],
    ]);
  });

  // ONE allowlist decides all of these, which is why they are one test. ssh
  // expands the WHOLE ControlPath and Nix SHELL-splits NIX_SSHOPTS, and the
  // directory half of ours comes from $XDG_RUNTIME_DIR — an environment string
  // both of them get to reinterpret. Each case is a real break, verified against
  // the real tools: the extra `%C` dies with `ControlPath too long (>= 108
  // bytes)` (two 40-byte hashes a length guard never counts), the unknown token
  // dies with `vdollar_percent_expand: unknown key %Z`, and a lone quote dies in
  // Nix 2.34.8 with `while splitting NIX_SSHOPTS … unterminated single quote`
  // — that last one passing a whitespace rule, an expansion rule and a length
  // rule alike while breaking every remote-store Nix command in the dial. The
  // deeper reason to refuse rather than escape or count harder: the directory
  // ssh would actually open the socket in must BE the directory we created and
  // whose 0700 ownership we verified, or the privacy check describes nothing.
  it("refuses multiplexing when the runtime dir is not literal path text", () => {
    for (const dirName of [
      "ka2 with space", // corrupts the NIX_SSHOPTS split; argv form stays right
      "ka2-%C%C", // an extra fixed-width token the byte budget never saw
      "ka2-%Z", // an unknown key — ssh fatals rather than expanding it
      "ka2-${HOME}", // the environment-expansion form
      "ka2-'q", // a lone single quote — Nix's shell-split fatals on it
      'ka2-"q', // and its double-quoted twin
    ]) {
      vi.stubEnv("XDG_RUNTIME_DIR", namedXdg(dirName));
      __resetControlMemo();
      expect(pairsFor()).toEqual([
        ["ControlMaster", "no"],
        ["ControlPath", "none"],
      ]);
      // Refused BEFORE the mkdir: a dir we will not name is not one to create.
      expect(existsSync(join("/tmp", dirName, "kolu-ssh"))).toBe(false);
    }
  });

  it("still multiplexes for a plain runtime dir — the control for that refusal", () => {
    // The allowlist is a rule about what a path may CONTAIN, not an excuse to be
    // picky: an ordinary directory still gets the speedup, with the one `%C` we
    // composed intact. Real runtime dirs (`/run/user/1000`, `/tmp/kolu-ssh-501`)
    // are ordinary in exactly this way.
    vi.stubEnv("XDG_RUNTIME_DIR", freshXdg());
    __resetControlMemo();
    const path = controlPathValue() as string;
    expect(path.endsWith("/%C-10x3")).toBe(true);
    // Exactly ONE token in the whole path — which is what makes the byte
    // arithmetic in `controlPathFits` (one `%C` subtracted) correct.
    expect(path.split("%").length - 1).toBe(1);
    expect(path).not.toContain("${");

    // A literal real-world shape (digits, dashes, slashes — the same alphabet
    // as `/run/user/1000` and the `/tmp/kolu-ssh-$UID` fallback), because "the
    // allowlist does not cost the speedup on a real box" is the claim it owes.
    vi.stubEnv("XDG_RUNTIME_DIR", namedXdg("kolu-ssh-501"));
    __resetControlMemo();
    expect(controlPathValue()).toBe("/tmp/kolu-ssh-501/kolu-ssh/%C-10x3");
  });

  // A ControlPath ssh cannot BIND is worse than no multiplexing: ssh does not
  // degrade, it dies with `ControlPath too long (… >= 108 bytes)` before it
  // connects. And the `-<policy>` suffix made this reachable where it was not:
  // with $XDG_RUNTIME_DIR = '/tmp/' + 'a'.repeat(49), the old `/%C` leaf expands
  // to 104 bytes and real ssh connects, while `/%C-10x3` expands to 109 and dies
  // — at the DEFAULT policy. So the expanded length is measured, not asserted.
  it("refuses multiplexing when the expanded ControlPath cannot fit sun_path", () => {
    vi.stubEnv("XDG_RUNTIME_DIR", namedXdg("a".repeat(49)));
    __resetControlMemo();
    expect(pairsFor()).toEqual([
      ["ControlMaster", "no"],
      ["ControlPath", "none"],
    ]);
    // Not merely "shorter than before": nothing over-long is emitted at all.
    expect(pairsFor(CI_KEEPALIVE)).toEqual([
      ["ControlMaster", "no"],
      ["ControlPath", "none"],
    ]);
  });

  it("refuses a multibyte runtime dir — where a `.length` check would not", () => {
    // 20 × U+00E9 is 20 characters and 40 bytes, so a `.length` budget would
    // call this path comfortably short while `sun_path`, a byte buffer, would
    // not. The allowlist settles it one step earlier (non-ASCII is not literal
    // path text), and the byte measurement behind it stays honest about the
    // buffer regardless.
    vi.stubEnv("XDG_RUNTIME_DIR", namedXdg("é".repeat(20)));
    __resetControlMemo();
    expect(pairsFor()).toEqual([
      ["ControlMaster", "no"],
      ["ControlPath", "none"],
    ]);
  });

  it("still multiplexes for a runtime dir of a realistic length", () => {
    // The guard must not cost the speedup on ordinary systems: a real
    // $XDG_RUNTIME_DIR is `/run/user/<uid>`, and the fixture is that short.
    vi.stubEnv("XDG_RUNTIME_DIR", freshXdg());
    __resetControlMemo();
    const path = controlPathValue() as string;
    expect(path.endsWith("/%C-10x3")).toBe(true);
    // What the guard actually promises, spelled out: the path OpenSSH binds —
    // %C expanded to its 40-byte hash, plus the `.<16 random>` name the master
    // binds first — still fits the smaller (macOS) 104-byte sun_path, NUL
    // included.
    const expanded = Buffer.byteLength(path) - "%C".length + 40;
    expect(expanded + 17 + 1).toBeLessThanOrEqual(104);
  });

  // The degrade must REFUSE, not fall silent. Emitting no control opts does not
  // mean "no multiplexing" — it means we stop naming a ControlPath, and ssh then
  // honours the user's own ~/.ssh/config, where an ordinary `Host *` block with
  // `ControlMaster auto` supplies a master keyed by host+user+port and NOT by
  // policy. Two tolerances would silently share one socket again.
  it("never degrades to an empty opt set, on any refusal path", () => {
    const xdg = freshXdg();
    vi.stubEnv("XDG_RUNTIME_DIR", `${xdg} with space`);
    __resetControlMemo();
    const pairs = pairsFor();
    expect(pairs.length).toBeGreaterThan(0);
    const opts = Object.fromEntries(pairs.map(([k, v]) => [k, v]));
    expect(opts.ControlPath).toBe("none");
    // Whitespace-free on both halves, or the NIX_SSHOPTS env form corrupts.
    for (const [k, v] of pairs) expect(/\s/.test(`${k}${v}`)).toBe(false);
  });
});
