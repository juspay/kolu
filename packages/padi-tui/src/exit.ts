import { Data, Runtime } from "effect";

export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly stderr: string;
}> {
  readonly [Runtime.errorExitCode] = 1;
  readonly [Runtime.errorReported] = false;
}

export class WaitTimedOut extends Data.TaggedError("WaitTimedOut")<{
  readonly stderr: string;
}> {
  readonly [Runtime.errorExitCode] = 2;
  readonly [Runtime.errorReported] = false;
}

export class WaitTerminalGone extends Data.TaggedError("WaitTerminalGone")<{
  readonly stderr: string;
}> {
  readonly [Runtime.errorExitCode] = 3;
  readonly [Runtime.errorReported] = false;
}

export class WaitInterrupted extends Data.TaggedError("WaitInterrupted")<{
  readonly stderr: string;
}> {
  readonly [Runtime.errorExitCode] = 130;
  readonly [Runtime.errorReported] = false;
}

export const failure = (message: string): CliFailure =>
  new CliFailure({ stderr: `padi-tui: ${message}\n` });

export function reportOf(error: unknown): string {
  const e = error as { readonly stderr?: unknown; readonly message?: unknown };
  if (typeof e?.stderr === "string") return e.stderr;
  return `padi-tui: ${typeof e?.message === "string" ? e.message : String(error)}\n`;
}

export function exitCodeOf(error: unknown): number {
  return Runtime.getErrorExitCode(error);
}
