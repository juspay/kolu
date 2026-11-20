import { isSurfaceCliFailure, type SurfaceCliFailure } from "@kolu/surface-cli";
import { Data, Runtime } from "effect";

export const CliExitCode = {
  refused: 1,
  timedOut: 2,
  terminalGone: 3,
  terminalAsleep: 4,
  interrupted: 130,
} as const;

export type CliExitCode = (typeof CliExitCode)[keyof typeof CliExitCode];

export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly reason: string;
  readonly stderr: string;
  readonly code: CliExitCode;
}> {
  get [Runtime.errorExitCode](): number {
    return this.code;
  }
  readonly [Runtime.errorReported] = false;
}

export const koluLine = (reason: string): string => `kolu: ${reason}\n`;

export const isFaceExitArm = (
  err: unknown,
): err is CliFailure | ReservedFaceError | SurfaceCliFailure => {
  const tag = (err as { readonly _tag?: unknown })?._tag;
  return (
    tag === "CliFailure" ||
    tag === "ReservedFaceError" ||
    isSurfaceCliFailure(err)
  );
};

export class ReservedFaceError extends Data.TaggedError("ReservedFaceError")<{
  readonly message: string;
}> {
  readonly [Runtime.errorExitCode] = 1;
  readonly [Runtime.errorReported] = false;
}

export class UsageRefused {
  readonly [Runtime.errorExitCode] = 1;
  readonly [Runtime.errorReported] = false;
}

export const failure = (message: string): CliFailure =>
  new CliFailure({
    reason: message,
    stderr: koluLine(message),
    code: CliExitCode.refused,
  });

export { isBlank } from "@kolu/padi/render";

export const blankFlag = (flag: string, names: string): CliFailure =>
  failure(
    `${flag} was passed with an empty value — an unset shell variable, most likely. It names ${names}; pass one, or drop the flag entirely.`,
  );

export const reservedFace = (face: string): ReservedFaceError =>
  new ReservedFaceError({
    message: `kolu ${face} is not shipped yet — it lands in a later PR of the kolu-cli plan: https://kolu.dev/atlas/kolu-cli.html`,
  });

export const waitTimedOut = (facts: {
  readonly terminal: string;
  readonly elapsedMs: number;
  readonly describe: string;
}): CliFailure => {
  const reason = `timed out after ${facts.elapsedMs}ms waiting for ${facts.terminal} to reach ${facts.describe}.`;
  return new CliFailure({
    reason,
    stderr: koluLine(reason),
    code: CliExitCode.timedOut,
  });
};

export const waitTerminalGone = (facts: {
  readonly terminal: string;
  readonly describe: string;
}): CliFailure => {
  const reason = `${facts.terminal} exited before reaching ${facts.describe} — its terminal is gone.`;
  return new CliFailure({
    reason,
    stderr: koluLine(reason),
    code: CliExitCode.terminalGone,
  });
};

export const terminalAsleep = (facts: {
  readonly terminal: string;
  readonly state: "sleeping" | "parked";
  readonly attempted: string;
}): CliFailure => {
  const reason =
    facts.state === "parked"
      ? `${facts.terminal} is parked — a saved terminal waiting to be restored, with no live screen; restore the session, then ${facts.attempted} again.`
      : `${facts.terminal} is asleep — wake it in kolu, then ${facts.attempted} again.`;
  return new CliFailure({
    reason,
    stderr: koluLine(reason),
    code: CliExitCode.terminalAsleep,
  });
};

export const waitInterrupted = (facts: {
  readonly terminal: string;
}): CliFailure => {
  const reason = `interrupted; ${facts.terminal} left running`;
  return new CliFailure({
    reason,
    stderr: koluLine(reason),
    code: CliExitCode.interrupted,
  });
};

export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export function renderDiagnostic(error: unknown): string {
  const e = error as { readonly stderr?: unknown; readonly message?: unknown };
  if (typeof e?.stderr === "string") return e.stderr;
  return `kolu: ${typeof e?.message === "string" ? e.message : errorMessage(error)}\n`;
}
