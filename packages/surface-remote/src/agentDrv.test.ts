import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  resolveSystem: vi.fn(),
  runCapture: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("./arch", () => ({ resolveSystem: h.resolveSystem }));
vi.mock("./process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./process")>();
  return { ...actual, runCapture: h.runCapture };
});
// The baked source's binary-cache.json read — every resolve requires it, so
// the default arm serves a valid sidecar and the contract tests override it.
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  readFileSync: h.readFile,
}));

import {
  AGENT_BINARY_CACHE_FILE,
  AgentBinaryCacheUnbakedError,
  readBakedBinaryCache,
} from "./agentBinaryCache";
import {
  AgentResolutionExhaustedError,
  AgentSourceUnbakedError,
  readBakedAgentSource,
  resolveAgentDrv,
  SURFACE_AGENT_FLAKE_REF_ENV,
} from "./agentDrv";
import { ResolveDrvError } from "./host";
import { makeProvisionBudgets } from "./nixCopy";

const success = (stdout: string) => ({
  ok: true,
  kind: "exit" as const,
  code: 0,
  stdout,
});

const VALID_SIDECAR = JSON.stringify({
  substituters: ["https://cache.test.invalid/oss"],
  trustedPublicKeys: ["oss:0000000000000000000000000000000000000000000="],
});

const resolutionOptions = {
  signal: new AbortController().signal,
  onProgress: vi.fn(),
  onEvaluation: vi.fn(),
  budget: makeProvisionBudgets().evaluation,
};

beforeEach(() => {
  h.readFile.mockReturnValue(VALID_SIDECAR);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  resolutionOptions.budget.reset();
});

describe("readBakedAgentSource", () => {
  it("normalizes the wrapper-baked source at the framework boundary", () => {
    vi.stubEnv(SURFACE_AGENT_FLAKE_REF_ENV, "  /nix/store/source  ");
    const source = readBakedAgentSource();
    expect(source.isOk()).toBe(true);
    if (source.isOk()) expect(source.value).toBe("/nix/store/source");
  });

  it("fails with a typed configuration error when the wrapper value is absent", () => {
    vi.stubEnv(SURFACE_AGENT_FLAKE_REF_ENV, "  ");
    const source = readBakedAgentSource();
    expect(source.isErr()).toBe(true);
    if (source.isErr()) {
      expect(source.error).toBeInstanceOf(AgentSourceUnbakedError);
    }
  });
});

describe("resolveAgentDrv", () => {
  it("derives the installable from the host-reported system and package name", async () => {
    h.resolveSystem.mockResolvedValue("aarch64-darwin");
    h.runCapture.mockResolvedValue(success("/nix/store/padi.drv\n"));

    await expect(
      resolveAgentDrv(
        "builder",
        "/nix/store/source-a",
        "padi",
        resolutionOptions,
      ),
    ).resolves.toMatchObject({
      kind: "flake-installable",
      drvPath: "/nix/store/padi.drv",
      installable: "/nix/store/source-a#packages.aarch64-darwin.padi",
    });

    expect(h.runCapture).toHaveBeenCalledWith(
      "nix",
      [
        "eval",
        "--accept-flake-config",
        "--raw",
        "/nix/store/source-a#packages.aarch64-darwin.padi.drvPath",
      ],
      expect.objectContaining({
        policy: {
          kind: "progress-liveness",
          silenceMs: expect.any(Number),
        },
        signal: resolutionOptions.signal,
      }),
    );
    expect(resolutionOptions.onEvaluation).toHaveBeenCalledTimes(1);
  });

  it("reuses the resolved derivation for later dials", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.runCapture.mockResolvedValueOnce(success("/nix/store/kaval.drv"));

    const args = [
      "builder",
      "/nix/store/source-b",
      "kaval",
      resolutionOptions,
    ] as const;
    await resolveAgentDrv(...args);
    await resolveAgentDrv(...args);

    expect(h.runCapture).toHaveBeenCalledTimes(1);
    expect(resolutionOptions.onEvaluation).toHaveBeenCalledTimes(1);
  });

  it("leaves an arch-probe failure as a retryable transport error", async () => {
    h.resolveSystem.mockRejectedValue(new Error("ssh timed out"));

    const failure = resolveAgentDrv(
      "offline",
      "/nix/store/source-c",
      "padi",
      resolutionOptions,
    );
    await expect(failure).rejects.toThrow("ssh timed out");
    await expect(failure).rejects.not.toBeInstanceOf(ResolveDrvError);
    expect(h.runCapture).not.toHaveBeenCalled();
  });

  it("classifies a Nix evaluation failure as terminal and keeps its diagnostics", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.runCapture.mockImplementation(
      async (
        _command: string,
        _args: readonly string[],
        opts: { onProgress?: (line: string) => void },
      ) => {
        opts.onProgress?.("attribute 'padi' missing");
        return { ok: false, kind: "exit", code: 1, stdout: "" };
      },
    );

    const failure = resolveAgentDrv(
      "builder",
      "/nix/store/source-d",
      "padi",
      resolutionOptions,
    );
    await expect(failure).rejects.toBeInstanceOf(ResolveDrvError);
    await expect(failure).rejects.toThrow(/attribute 'padi' missing/);
    expect(resolutionOptions.onProgress).toHaveBeenCalledWith(
      "attribute 'padi' missing",
    );
  });

  it("retries a transient Nix source fetch failure", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.runCapture
      .mockImplementationOnce(
        async (
          _command: string,
          _args: readonly string[],
          opts: { onProgress?: (line: string) => void },
        ) => {
          opts.onProgress?.(
            "error: unable to download 'https://example.invalid/source.tar.gz': Could not resolve host",
          );
          for (let line = 1; line <= 25; line += 1) {
            opts.onProgress?.(`trace context ${line}`);
          }
          return { ok: false, kind: "exit", code: 1, stdout: "" };
        },
      )
      .mockResolvedValueOnce(success("/nix/store/recovered-fetch-padi.drv"));

    const args = [
      "builder",
      "/nix/store/source-fetch",
      "padi",
      resolutionOptions,
    ] as const;
    const first = resolveAgentDrv(...args);
    await expect(first).rejects.not.toBeInstanceOf(ResolveDrvError);
    await expect(resolveAgentDrv(...args)).resolves.toMatchObject({
      drvPath: "/nix/store/recovered-fetch-padi.drv",
    });

    expect(h.runCapture).toHaveBeenCalledTimes(2);
  });

  it("keeps a permanent missing-source response terminal", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.runCapture.mockImplementation(
      async (
        _command: string,
        _args: readonly string[],
        opts: { onProgress?: (line: string) => void },
      ) => {
        opts.onProgress?.(
          "error: unable to download 'https://example.invalid/missing.tar.gz': HTTP error 404",
        );
        return { ok: false, kind: "exit", code: 1, stdout: "" };
      },
    );

    const failure = resolveAgentDrv(
      "builder",
      "/nix/store/source-missing",
      "padi",
      resolutionOptions,
    );
    await expect(failure).rejects.toBeInstanceOf(ResolveDrvError);
  });

  it("keeps an externally killed Nix evaluation terminal to avoid OOM retry thrash", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.runCapture.mockResolvedValue({
      ok: false,
      kind: "signal",
      signal: "SIGKILL",
      stdout: "",
    });

    const failure = resolveAgentDrv(
      "builder",
      "/nix/store/source-killed",
      "padi",
      resolutionOptions,
    );
    await expect(failure).rejects.toBeInstanceOf(ResolveDrvError);
  });

  it("keeps only the bounded diagnostic tail", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.runCapture.mockImplementation(
      async (
        _command: string,
        _args: readonly string[],
        opts: { onProgress?: (line: string) => void },
      ) => {
        for (let line = 1; line <= 25; line += 1) {
          opts.onProgress?.(`diagnostic ${line}`);
        }
        return { ok: false, kind: "exit", code: 1, stdout: "" };
      },
    );

    const failure = resolveAgentDrv(
      "builder",
      "/nix/store/source-noisy",
      "padi",
      resolutionOptions,
    );
    await expect(failure).rejects.not.toThrow(/diagnostic 5(?:\D|$)/);
    await expect(failure).rejects.toThrow(/diagnostic 6/);
    await expect(failure).rejects.toThrow(/diagnostic 25/);
  });

  it("does not share host-specific failures across hosts", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.runCapture.mockImplementation(
      async (
        _command: string,
        _args: readonly string[],
        opts: { onProgress?: (line: string) => void },
      ) => {
        opts.onProgress?.("attribute 'padi' missing");
        return { ok: false, kind: "exit", code: 1, stdout: "" };
      },
    );

    const first = resolveAgentDrv(
      "builder-a",
      "/nix/store/source-hosts",
      "padi",
      resolutionOptions,
    );
    const second = resolveAgentDrv(
      "builder-b",
      "/nix/store/source-hosts",
      "padi",
      resolutionOptions,
    );
    await expect(first).rejects.toThrow(/^builder-a:/);
    await expect(second).rejects.toThrow(/^builder-b:/);
    expect(h.runCapture).toHaveBeenCalledTimes(2);
  });

  it("leaves a silent failed evaluation uncached so the next dial retries", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.runCapture
      .mockResolvedValueOnce({
        ok: false,
        kind: "lifetime-expired",
        policy: { kind: "progress-liveness", silenceMs: 120_000 },
        signal: "SIGTERM",
        stdout: "",
      })
      .mockResolvedValueOnce(success("/nix/store/recovered-padi.drv"));

    const args = [
      "builder",
      "/nix/store/source-timeout",
      "padi",
      resolutionOptions,
    ] as const;
    const first = resolveAgentDrv(...args);
    await expect(first).rejects.toThrow(/no output/);
    await expect(first).rejects.not.toBeInstanceOf(ResolveDrvError);
    await expect(resolveAgentDrv(...args)).resolves.toMatchObject({
      drvPath: "/nix/store/recovered-padi.drv",
    });

    expect(h.runCapture).toHaveBeenCalledTimes(2);
  });

  it("gives up after the campaign's silent evaluation budget is exhausted", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.runCapture.mockResolvedValue({
      ok: false,
      kind: "lifetime-expired",
      policy: { kind: "progress-liveness", silenceMs: 120_000 },
      signal: "SIGTERM",
      stdout: "",
    });

    const args = [
      "builder",
      "/nix/store/source-exhausted",
      "padi",
      {
        ...resolutionOptions,
        budget: makeProvisionBudgets().evaluation,
      },
    ] as const;
    for (let attempt = 1; attempt < 4; attempt += 1) {
      await expect(resolveAgentDrv(...args)).rejects.not.toBeInstanceOf(
        ResolveDrvError,
      );
    }
    await expect(resolveAgentDrv(...args)).rejects.toBeInstanceOf(
      AgentResolutionExhaustedError,
    );
  });

  it("rejects output that is not a derivation path", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.runCapture.mockResolvedValue(success("/nix/store/not-a-derivation"));

    await expect(
      resolveAgentDrv(
        "builder",
        "/nix/store/source-e",
        "padi",
        resolutionOptions,
      ),
    ).rejects.toThrow(/not a derivation path/);
  });
});

describe("readBakedBinaryCache", () => {
  it("returns the sidecar's declaration and strips a path: ref prefix", () => {
    const cache = readBakedBinaryCache("path:/nix/store/src")._unsafeUnwrap();
    expect(h.readFile).toHaveBeenCalledWith(
      `/nix/store/src/${AGENT_BINARY_CACHE_FILE}`,
      "utf8",
    );
    expect(cache.substituters).toEqual(["https://cache.test.invalid/oss"]);
    expect(cache.trustedPublicKeys).toHaveLength(1);
  });

  it("errs with the typed unbaked fault when the sidecar is unreadable", () => {
    h.readFile.mockImplementation(() => {
      throw Object.assign(new Error("ENOENT: no such file"), {
        code: "ENOENT",
      });
    });
    expect(
      readBakedBinaryCache("/nix/store/pre-contract")._unsafeUnwrapErr(),
    ).toBeInstanceOf(AgentBinaryCacheUnbakedError);
  });

  it("errs with the typed unbaked fault on malformed JSON", () => {
    h.readFile.mockReturnValue("not-json{");
    expect(
      readBakedBinaryCache("/nix/store/src")._unsafeUnwrapErr(),
    ).toBeInstanceOf(AgentBinaryCacheUnbakedError);
  });

  it("rejects an empty or wrongly-shaped declaration — cache-blind is unspellable", () => {
    for (const bad of [
      { substituters: [], trustedPublicKeys: ["k"] },
      { substituters: ["u"], trustedPublicKeys: [] },
      { substituters: ["u"] },
      { substituters: ["u"], trustedPublicKeys: [" "] },
      { substituters: [42], trustedPublicKeys: ["k"] },
      null,
    ]) {
      h.readFile.mockReturnValue(JSON.stringify(bad));
      expect(
        readBakedBinaryCache("/nix/store/src")._unsafeUnwrapErr(),
      ).toBeInstanceOf(AgentBinaryCacheUnbakedError);
    }
  });

  it("resolveAgentDrv threads the sidecar onto the derivation it returns", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.runCapture.mockResolvedValue(
      success("/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-padi.drv"),
    );
    const drv = await resolveAgentDrv(
      "builder",
      "/nix/store/source-cache-thread",
      "padi",
      resolutionOptions,
    );
    expect(drv.binaryCache.substituters).toEqual([
      "https://cache.test.invalid/oss",
    ]);
  });

  it("fails the resolve, typed, before the arch probe or a Nix evaluation when the sidecar is absent", async () => {
    h.resolveSystem.mockResolvedValue("x86_64-linux");
    h.readFile.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    await expect(
      resolveAgentDrv(
        "builder",
        "/nix/store/source-pre-contract",
        "padi",
        resolutionOptions,
      ),
    ).rejects.toBeInstanceOf(AgentBinaryCacheUnbakedError);
    // The DETERMINISTIC local fault precedes both the ssh arch probe and any
    // `nix eval` spawn — so an unreachable host can never mask it with a
    // nondeterministic transport fault.
    expect(h.resolveSystem).not.toHaveBeenCalled();
    expect(h.runCapture).not.toHaveBeenCalled();
  });
});
