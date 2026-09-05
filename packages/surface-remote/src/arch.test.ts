/**
 * Coverage for `resolveSystem`'s dial-owned host probe. Every dial asks the
 * target because a hostname can change identity while Kolu remains open, and
 * cancellation must never leak across a recheck.
 * Mocks `./process` so no ssh is ever spawned.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSystem } from "./arch";
import { useControlDir } from "./controlDir.testutil";
import { ResolveDrvError } from "./host";
import { type CaptureResult, runCapture } from "./process";

vi.mock("./process", async (importOriginal) => ({
  // Keep the real pure helpers (`describeExit`) and mock only the two
  // subprocess-spawning entry points.
  ...(await importOriginal<typeof import("./process")>()),
  runCapture: vi.fn(),
}));

// The argv builder appends ControlMaster opts (which mkdir a control dir); the
// shared fixture points it at a throwaway private runtime dir per test. The
// mocked `runCapture` means no ssh runs regardless.
useControlDir("kolu-ssh-arch-");
afterEach(() => {
  vi.clearAllMocks();
});

const okSystem = (sys: string) =>
  ({ ok: true, kind: "exit", code: 0, stdout: `"${sys}"\n` }) as const;
const opts = () => ({
  signal: new AbortController().signal,
  onProgress: vi.fn(),
});

describe("resolveSystem host probe", () => {
  it("re-probes a host on every dial", async () => {
    vi.mocked(runCapture).mockResolvedValue(okSystem("x86_64-linux"));
    const a = await resolveSystem("h-memo", opts());
    const b = await resolveSystem("h-memo", opts());
    expect(a).toBe("x86_64-linux");
    expect(b).toBe("x86_64-linux");
    expect(runCapture).toHaveBeenCalledTimes(2);
  });

  it("keeps concurrent first probes in their owning dial lifetimes", async () => {
    vi.mocked(runCapture).mockResolvedValue(okSystem("aarch64-darwin"));
    const [a, b] = await Promise.all([
      resolveSystem("h-race", opts()),
      resolveSystem("h-race", opts()),
    ]);
    expect(a).toBe("aarch64-darwin");
    expect(b).toBe("aarch64-darwin");
    expect(runCapture).toHaveBeenCalledTimes(2);
  });

  it("re-probes after a failed dial", async () => {
    vi.mocked(runCapture)
      .mockResolvedValueOnce({ ok: false, kind: "exit", code: 1, stdout: "" }) // unreachable
      .mockResolvedValueOnce(okSystem("x86_64-linux")); // host answers now
    await expect(resolveSystem("h-reject", opts())).rejects.toThrow();
    const sys = await resolveSystem("h-reject", opts());
    expect(sys).toBe("x86_64-linux");
    expect(runCapture).toHaveBeenCalledTimes(2); // the failure was not cached
  });

  it("keeps an unresolved probe owned by its dial's abort signal", async () => {
    const first = new AbortController();
    vi.mocked(runCapture)
      .mockImplementationOnce(
        async (_command, _args, runOpts): Promise<CaptureResult> =>
          await new Promise<CaptureResult>((resolve) => {
            runOpts.signal?.addEventListener(
              "abort",
              () => resolve({ ok: false, kind: "aborted", stdout: "" }),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce(okSystem("aarch64-darwin"));

    const abandoned = resolveSystem("h-abort-owner", {
      signal: first.signal,
      onProgress: vi.fn(),
    });
    first.abort();
    await expect(abandoned).rejects.toThrow(/aborted/);

    await expect(resolveSystem("h-abort-owner", opts())).resolves.toBe(
      "aarch64-darwin",
    );
    expect(runCapture).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runCapture).mock.calls[0]?.[2]?.signal).toBe(first.signal);
  });
});

/** An ssh gate kolu can never pass non-interactively must reach the session as a
 *  TERMINAL, cause-typed fault — otherwise it is classified as a transport blip
 *  and redialed forever, leaving the host wedged on "Connecting…" with the real
 *  reason buried in a log tail. */
describe("resolveSystem ssh-refusal classification", () => {
  /** Mock one probe that emits `line` on stderr and exits with `code`. */
  const probeEmitting = (line: string, code: number): void => {
    vi.mocked(runCapture).mockImplementationOnce(
      async (_command, _args, runOpts): Promise<CaptureResult> => {
        runOpts.onProgress?.(line);
        return { ok: false, kind: "exit", code, stdout: "" };
      },
    );
  };

  const PERMISSION_DENIED =
    "srid@petit: Permission denied (publickey,password,keyboard-interactive).";
  const HOST_KEY_FAILED = "Host key verification failed.";

  /** Reject and return the error — `.rejects.toThrow` can't inspect the typed
   *  `resolution`, which is the whole point of these arms. */
  const failureOf = async (host: string): Promise<unknown> =>
    await resolveSystem(host, opts()).then(
      () => {
        throw new Error("expected the probe to reject");
      },
      (e: unknown) => e,
    );

  it("a password-only host is a TERMINAL auth-refused fault, not an eternal retry", async () => {
    probeEmitting(PERMISSION_DENIED, 255);
    const err = await failureOf("petit");
    expect(err).toBeInstanceOf(ResolveDrvError);
    expect((err as ResolveDrvError).resolution).toEqual({
      kind: "auth-refused",
      // The host was REACHED and refused us — the honest transport cause is
      // `remote`, and terminal because no redial can type a password.
      failureCause: "remote",
      terminal: true,
    });
    // The message carries the operator's actual remedy, not just the raw line.
    expect((err as Error).message).toContain("ssh-copy-id petit");
    expect((err as Error).message).toContain(PERMISSION_DENIED);
  });

  it("an unverified host key is its OWN terminal cause — a different remedy", async () => {
    probeEmitting(HOST_KEY_FAILED, 255);
    const err = await failureOf("petit");
    expect((err as ResolveDrvError).resolution).toEqual({
      kind: "host-key-unverified",
      failureCause: "remote",
      terminal: true,
    });
    expect((err as Error).message).toMatch(/accept the host key/);
  });

  it("requires ssh's OWN exit 255 — a remote command's refusal text stays retryable", async () => {
    // ssh reports its own failures with 255; any other code came from the
    // remote command, whose stderr rides the same stream. Terminality must not
    // hinge on text alone, or a remote-side hiccup would strand a good host.
    probeEmitting(PERMISSION_DENIED, 1);
    const err = await failureOf("petit");
    expect(err).not.toBeInstanceOf(ResolveDrvError);
    expect(err).toBeInstanceOf(Error);
  });

  it("still forwards the refusal line to the caller's progress sink", async () => {
    // The typed classification is additive: the raw ssh line must keep reaching
    // the session log tail the connect canvas renders.
    probeEmitting(PERMISSION_DENIED, 255);
    const onProgress = vi.fn();
    // The rejection is asserted by its own case above; this one is only about
    // what reached the progress sink, so the (known, deliberate) rejection is
    // swallowed rather than re-asserted.
    await resolveSystem("petit", {
      signal: new AbortController().signal,
      onProgress,
    }).catch(() => {});
    expect(onProgress).toHaveBeenCalledWith(PERMISSION_DENIED);
  });

  it("leaves an unreachable host retryable — an untyped transport error", async () => {
    probeEmitting(
      "ssh: connect to host petit port 22: Connection refused",
      255,
    );
    const err = await failureOf("petit");
    expect(err).not.toBeInstanceOf(ResolveDrvError);
  });

  it("a host with no runnable Nix is terminal too — exit 127, whatever the shell says", async () => {
    // The OTHER unmet prerequisite. Provisioning uses the host's own Nix, so an
    // absent one is as unanswerable as a password — and 127 is POSIX, so this
    // holds for every shell without matching any of their differing prose.
    probeEmitting("bash: nix-instantiate: command not found", 127);
    const err = await failureOf("petit");
    expect((err as ResolveDrvError).resolution).toEqual({
      kind: "nix-unavailable",
      failureCause: "remote",
      terminal: true,
    });
    // Names the likelier cause (a login-shell-only Nix profile) and how to check.
    expect((err as Error).message).toMatch(/NON-INTERACTIVE ssh session/);
    expect((err as Error).message).toContain(
      "ssh petit nix-instantiate --version",
    );
  });

  it("classifies exit 127 by CODE, not by the shell's wording", async () => {
    // fish says "Unknown command", dash says "not found" — a prose matcher would
    // miss them and silently restore the eternal retry. The code cannot vary.
    probeEmitting("fish: Unknown command: nix-instantiate", 127);
    expect((await failureOf("petit")) as ResolveDrvError).toMatchObject({
      resolution: { kind: "nix-unavailable" },
    });
  });

  it("a nix that RAN and failed stays retryable — 127 is not any nonzero exit", async () => {
    // nix-instantiate exiting 1 means Nix is present and something else went
    // wrong; that is not this cause and must not be made terminal.
    probeEmitting("error: some transient nix failure", 1);
    expect(await failureOf("petit")).not.toBeInstanceOf(ResolveDrvError);
  });

  /** Mock one probe whose spawn FAILS (no exit code is ever produced). */
  const probeSpawnFailing = (message: string, code?: string): void => {
    vi.mocked(runCapture).mockImplementationOnce(
      async (): Promise<CaptureResult> => ({
        ok: false,
        kind: "spawn-error",
        message,
        code,
        stdout: "",
      }),
    );
  };

  it("a LOCALHOST probe with no nix reaches the same terminal cause — via ENOENT, not 127", async () => {
    // The localhost arm spawns `nix-instantiate` DIRECTLY, so an absent binary
    // never runs and never yields an exit code — Node raises ENOENT instead.
    // Classifying only on 127 left this case falling through to the untyped
    // error, i.e. retrying forever while narrating "host unreachable" — the very
    // defect the 127 arm exists to end.
    probeSpawnFailing("spawn nix-instantiate ENOENT", "ENOENT");
    const err = await failureOf("localhost");
    expect((err as ResolveDrvError).resolution).toEqual({
      kind: "nix-unavailable",
      failureCause: "remote",
      terminal: true,
    });
    // Phrased for the LOCAL arm — no "ssh session" talk, and a local check command.
    expect((err as Error).message).toContain("nix-instantiate --version");
    expect((err as Error).message).not.toMatch(/NON-INTERACTIVE ssh session/);
  });

  it("a missing local `ssh` is about THIS machine, not the far end — and is bounded", async () => {
    // On the ssh arm the binary we spawn is `ssh`, so ENOENT says nothing about
    // the remote host's Nix. Bounded rather than terminal: it must stop retrying
    // without asserting a verdict about a host we never reached.
    probeSpawnFailing("spawn ssh ENOENT", "ENOENT");
    const err = await failureOf("petit");
    expect((err as ResolveDrvError).resolution).toEqual({
      kind: "unavailable",
      failureCause: "remote",
      terminal: false,
    });
    expect((err as Error).message).toMatch(
      /could not run `ssh` on THIS machine/,
    );
    expect((err as Error).message).not.toMatch(/nix-instantiate/);
  });

  it("a TRANSIENT spawn fault stays retryable — only ENOENT means absent", async () => {
    // EMFILE/EAGAIN are local resource exhaustion, which a later dial may well
    // clear. Terminalising every spawn fault would strand a recoverable host, so
    // the errno — not merely `kind: "spawn-error"` — is what decides.
    probeSpawnFailing("spawn nix-instantiate EMFILE", "EMFILE");
    expect(await failureOf("localhost")).not.toBeInstanceOf(ResolveDrvError);
  });

  it("keeps a refusal PER DIAL — a later clean probe resolves normally", async () => {
    // `drvFaultCause`-style staleness at the framework layer: the classifier
    // holds no state across dials, so a fixed host recovers on the next probe.
    probeEmitting(PERMISSION_DENIED, 255);
    await failureOf("petit");
    vi.mocked(runCapture).mockResolvedValueOnce(okSystem("x86_64-linux"));
    await expect(resolveSystem("petit", opts())).resolves.toBe("x86_64-linux");
  });
});
