/**
 * `pullClosure`'s steps — warm check, the host's own `nix copy --from <cache>`,
 * the GC-root commit — with `./process` mocked so the assertions see exactly
 * the argv that would hit the wire (the real `./host` builds it).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useControlDir } from "./controlDir.testutil";
import { sshKeepalive } from "./keepalive";
import {
  PROVISION_COPY_SILENCE_MS,
  PROVISION_STEP_SILENCE_BASE_MS,
} from "./nixCopy";
import { nixErrorLine } from "./nixLog.testutil";
import { type CaptureResult, runCapture } from "./process";
import { pullClosure } from "./pullClosure";

vi.mock("./process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./process")>()),
  runCapture: vi.fn(),
}));

const CA = "/nix/store/r6r8xkl3fvi5is4ckfbl6sl1wacz2rak-agent-distro-vanilla";
const CACHE = "https://cache.example/oss";
const ROOT = ".local/state/kolu/agent-distro/gcroots/vanilla";

const okOut: CaptureResult = { ok: true, kind: "exit", code: 0, stdout: "" };
const failOut: CaptureResult = { ok: false, kind: "exit", code: 1, stdout: "" };

const isCheck = (args: readonly string[]) => args.includes("--check-validity");
const isCopy = (args: readonly string[]) =>
  args.includes("copy") && args.includes("--from");
const isPin = (args: readonly string[]) => args.includes("--add-root");

useControlDir("kolu-ssh-pull-");
afterEach(() => vi.clearAllMocks());

const pull = (host = "ci@croissant", onProgress = vi.fn()) =>
  pullClosure({
    host,
    cacheUrl: CACHE,
    storePath: CA,
    rootPath: ROOT,
    onProgress,
    keepalive: sshKeepalive(10, 3),
  });
const calls = () => vi.mocked(runCapture).mock.calls;

describe("pullClosure — the host pulls a content-addressed closure from the cache", () => {
  it("a warm host is rooted and never copied to", async () => {
    vi.mocked(runCapture).mockResolvedValue(okOut);
    expect(await pull()).toEqual({ ok: true });
    expect(calls().some(([, a]) => isCopy(a))).toBe(false);
    const pin = calls().find(([, a]) => isPin(a));
    expect(pin?.[0]).toBe("ssh");
    expect(pin?.[1]).toEqual(
      expect.arrayContaining([
        "nix-store",
        "--realise",
        CA,
        "--add-root",
        ROOT,
        "--indirect",
      ]),
    );
  });

  it("a cold host copies from the cache ON the host, then roots — in that order", async () => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args) =>
      isCheck(args) ? failOut : okOut,
    );
    expect(await pull()).toEqual({ ok: true });
    const order = calls().map(([, a]) =>
      isCheck(a) ? "check" : isCopy(a) ? "copy" : isPin(a) ? "pin" : "?",
    );
    expect(order).toEqual(["check", "copy", "pin"]);
    const [cmd, args] = calls().find(([, a]) => isCopy(a)) ?? [];
    // Over ssh: the HOST reads the cache — no `--to`, nothing leaves here.
    expect(cmd).toBe("ssh");
    // `nix-command` lifted on the command line: a stock host Nix ships with
    // it off, and the host must need no setting for it.
    const nix = args?.indexOf("nix") ?? -1;
    expect(args?.slice(nix)).toEqual([
      "nix",
      "--log-format",
      "internal-json",
      "--extra-experimental-features",
      "nix-command",
      "-v",
      "copy",
      "--from",
      CACHE,
      CA,
    ]);
    expect(args).not.toContain("--to");
  });

  it("the copy runs under the fixed copy bound, the root commit under a fresh provisioning budget", async () => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args) =>
      isCheck(args) ? failOut : okOut,
    );
    await pull();
    const copy = calls().find(([, a]) => isCopy(a));
    expect(copy?.[2].policy).toEqual({
      kind: "progress-liveness",
      silenceMs: PROVISION_COPY_SILENCE_MS,
    });
    const pin = calls().find(([, a]) => isPin(a));
    expect(pin?.[2].policy).toEqual({
      kind: "progress-liveness",
      silenceMs: PROVISION_STEP_SILENCE_BASE_MS,
    });
  });

  it("the local arm runs the same steps without ssh", async () => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args) =>
      isCheck(args) ? failOut : okOut,
    );
    vi.stubEnv("HOME", "/home/u");
    await pull("localhost");
    vi.unstubAllEnvs();
    expect(calls().map(([c]) => c)).toEqual(["nix-store", "nix", "nix-store"]);
  });

  it("a copy the cache cannot serve is `uncopied` in Nix's words, and nothing is rooted", async () => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args, opts) => {
      if (isCopy(args)) {
        opts.onProgress?.(
          nixErrorLine(`path '${CA}' is not available from ${CACHE}`),
        );
        return failOut;
      }
      return isCheck(args) ? failOut : okOut;
    });
    expect(await pull()).toMatchObject({
      ok: false,
      kind: "uncopied",
      reason: expect.stringContaining("is not available"),
    });
    expect(calls().some(([, a]) => isPin(a))).toBe(false);
  });

  it("a silent copy is killed at the copy bound and reported as a retryable failure", async () => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args) =>
      isCopy(args)
        ? {
            ok: false,
            kind: "lifetime-expired",
            policy: { kind: "progress-liveness", silenceMs: 1 },
            signal: "SIGTERM",
            stdout: "",
          }
        : failOut,
    );
    expect(await pull()).toMatchObject({
      ok: false,
      kind: "failed",
      cause: "network",
    });
  });

  it("the copy narrates through onProgress, prefixed with the host", async () => {
    vi.mocked(runCapture).mockImplementation(async (_cmd, args) =>
      isCheck(args) ? failOut : okOut,
    );
    const onProgress = vi.fn();
    await pull("ci@croissant", onProgress);
    expect(onProgress).toHaveBeenCalledWith(
      `ci@croissant: pulling ${CA} from ${CACHE}…`,
    );
  });
});
