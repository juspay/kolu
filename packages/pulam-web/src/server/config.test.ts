/**
 * `makeResolveDrvPath` / `readInitialHosts` — the boot-time, statically-resolved
 * config axis.
 *
 * The load-bearing claim under test (F4): a host whose system is PROBED fine but
 * has no derivation baked must reject with a `ResolveDrvError` carrying
 * `cause: "remote"` — so `HostSession` classifies it bounded → terminal
 * (`failed`) instead of its default `"network"` (retry forever), which would
 * make a mis-baked/unsupported system masquerade as a sleeping host. We mock
 * `resolveSystem` so no ssh ever runs; `ResolveDrvError` is kept real (the
 * partial mock spreads the actual module).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ResolveDrvError } from "@kolu/surface-nix-host";
import {
  makeResolveDrvPath,
  parsePort,
  PULAM_AGENT_DRVS_ENV,
  PULAM_WEB_KAVAL_SOCKETS_ENV,
  readInitialHosts,
  readKavalSockets,
} from "./config.ts";

const { resolveSystemMock } = vi.hoisted(() => ({
  resolveSystemMock: vi.fn<(host: string) => Promise<string>>(),
}));

vi.mock("@kolu/surface-nix-host", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@kolu/surface-nix-host")>();
  return { ...actual, resolveSystem: resolveSystemMock };
});

afterEach(() => vi.clearAllMocks());

describe("makeResolveDrvPath", () => {
  it("returns the baked drv for a probed system", async () => {
    resolveSystemMock.mockResolvedValue("x86_64-linux");
    const resolve = makeResolveDrvPath({
      [PULAM_AGENT_DRVS_ENV]: JSON.stringify({
        "x86_64-linux": "/nix/store/abc.drv",
      }),
    } as NodeJS.ProcessEnv);
    await expect(resolve("box-a")).resolves.toBe("/nix/store/abc.drv");
  });

  it("rejects an absent system key as a ResolveDrvError with cause 'remote' (non-retryable)", async () => {
    // The host probes fine, but its system isn't in the baked map: a config
    // error retrying can never fix. Must be `"remote"`, not the `"network"`
    // default — otherwise HostSession would spin on it forever.
    resolveSystemMock.mockResolvedValue("aarch64-darwin");
    const resolve = makeResolveDrvPath({
      [PULAM_AGENT_DRVS_ENV]: JSON.stringify({
        "x86_64-linux": "/nix/store/abc.drv",
      }),
    } as NodeJS.ProcessEnv);

    const err = await resolve("box-mac").then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ResolveDrvError);
    expect((err as ResolveDrvError).cause).toBe("remote");
    expect((err as Error).message).toContain("aarch64-darwin");
    expect((err as Error).message).toContain("x86_64-linux"); // names what IS baked
  });

  it("propagates a resolveSystem (unreachable host) rejection untouched → HostSession's network default", async () => {
    // An ssh-probe failure is a plain rejection, NOT a ResolveDrvError — so
    // HostSession falls back to its `"network"` default and retries forever.
    resolveSystemMock.mockRejectedValue(
      new Error("ssh: connect to host: down"),
    );
    const resolve = makeResolveDrvPath({
      [PULAM_AGENT_DRVS_ENV]: JSON.stringify({
        "x86_64-linux": "/nix/store/abc.drv",
      }),
    } as NodeJS.ProcessEnv);
    const err = await resolve("box-down").then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(ResolveDrvError);
    expect((err as Error).message).toContain("ssh: connect to host");
  });

  it("throws eagerly when the drv map env is absent (Nix wrapper not used)", () => {
    expect(() => makeResolveDrvPath({} as NodeJS.ProcessEnv)).toThrow(
      PULAM_AGENT_DRVS_ENV,
    );
  });
});

describe("readInitialHosts", () => {
  it("splits, trims, and drops empties", () => {
    expect(
      readInitialHosts({
        PULAM_WEB_HOSTS: " a , b ,, c ",
      } as NodeJS.ProcessEnv),
    ).toEqual(["a", "b", "c"]);
  });

  it("rejects a host that ssh would parse as an option or that has whitespace", () => {
    expect(() =>
      readInitialHosts({
        PULAM_WEB_HOSTS: "-oProxyCommand=x",
      } as NodeJS.ProcessEnv),
    ).toThrow("invalid host");
  });

  it("an unset/empty env yields an empty list (the caller decides it's fatal)", () => {
    expect(readInitialHosts({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(
      readInitialHosts({ PULAM_WEB_HOSTS: "   " } as NodeJS.ProcessEnv),
    ).toEqual([]);
  });
});

describe("parsePort", () => {
  it("uses the fallback ONLY when unset or blank", () => {
    expect(parsePort("P", undefined, 4800)).toBe(4800);
    expect(parsePort("P", "", 4800)).toBe(4800);
    expect(parsePort("P", "   ", 4800)).toBe(4800);
  });

  it("returns a valid integer port as-is", () => {
    expect(parsePort("P", "8080", 4800)).toBe(8080);
    expect(parsePort("P", " 80 ", 4800)).toBe(80);
    expect(parsePort("P", "65535", 4800)).toBe(65535);
  });

  it("throws on a malformed value instead of silently using the default", () => {
    // The exact F6 regression: `Number("abc") || 4800` and `Number("0") || 4800`
    // both silently yield 4800; parsePort rejects both loudly.
    expect(() => parsePort("PULAM_WEB_PORT", "abc", 4800)).toThrow(
      "PULAM_WEB_PORT",
    );
    expect(() => parsePort("P", "12.5", 4800)).toThrow("invalid port");
    expect(() => parsePort("P", "1e3", 4800)).toThrow("invalid port");
    expect(() => parsePort("P", "0x10", 4800)).toThrow("invalid port");
  });

  it("rejects explicit 0 and out-of-range ports", () => {
    expect(() => parsePort("P", "0", 4800)).toThrow("out of range");
    expect(() => parsePort("P", "99999", 4800)).toThrow("out of range");
  });
});

describe("readKavalSockets", () => {
  it("an unset/empty env yields an empty map (every host runs one kaval)", () => {
    expect(readKavalSockets({} as NodeJS.ProcessEnv).size).toBe(0);
    expect(
      readKavalSockets({
        [PULAM_WEB_KAVAL_SOCKETS_ENV]: "  ",
      } as NodeJS.ProcessEnv).size,
    ).toBe(0);
  });

  it("parses host=socket pairs, trimming + dropping blanks", () => {
    const map = readKavalSockets({
      [PULAM_WEB_KAVAL_SOCKETS_ENV]:
        " srid@mac=/tmp/kaval-0/pty-host.sock , nix@box=/run/user/1000/kaval/pty-host.sock ,, ",
    } as NodeJS.ProcessEnv);
    expect(map.get("srid@mac")).toBe("/tmp/kaval-0/pty-host.sock");
    expect(map.get("nix@box")).toBe("/run/user/1000/kaval/pty-host.sock");
    expect(map.size).toBe(2);
  });

  it("splits on the FIRST `=` only, so a socket path may contain `=`", () => {
    const map = readKavalSockets({
      [PULAM_WEB_KAVAL_SOCKETS_ENV]: "host=/tmp/a=b/sock",
    } as NodeJS.ProcessEnv);
    expect(map.get("host")).toBe("/tmp/a=b/sock");
  });

  it("fails fast on a malformed entry (no `=`, empty host, or empty socket)", () => {
    for (const bad of ["nosocket", "=/tmp/sock", "host="]) {
      expect(() =>
        readKavalSockets({
          [PULAM_WEB_KAVAL_SOCKETS_ENV]: bad,
        } as NodeJS.ProcessEnv),
      ).toThrow(PULAM_WEB_KAVAL_SOCKETS_ENV);
    }
  });
});
