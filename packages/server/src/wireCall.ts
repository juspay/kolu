import { websocketLink } from "@kolu/surface/links/websocket";
import { surfaceWsUrl } from "@kolu/surface-app";
import { isStaleProcessClose } from "@kolu/surface-app/connect";
import { Cause, Effect, Exit, Schema } from "effect";
import type { Rpc } from "effect/rpc";
import { koluWireGroup } from "kolu-common/surfacesWithPadi";

const DEFAULT_TIMEOUT_MS = 30_000;

interface Args {
  readonly baseUrl: string;
  readonly tag: string;
  readonly payload: unknown;
  readonly timeoutMs: number;
}

const USAGE =
  "usage: kolu-rpc <http-base-url> <wire-tag> [payload-json] [--timeout-ms <n>]";

function die(message: string): never {
  process.stderr.write(`kolu-rpc: ${message}\n`);
  process.exit(1);
}

export function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--timeout-ms") {
      const raw = argv[i + 1];
      const parsed = Number(raw);
      if (raw === undefined || !Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--timeout-ms needs a positive number, got ${raw}`);
      }
      timeoutMs = parsed;
      i += 1;
      continue;
    }
    positional.push(arg);
  }
  const [baseUrl, tag, payloadJson] = positional;
  if (baseUrl === undefined || tag === undefined) throw new Error(USAGE);
  if (positional.length > 3) {
    throw new Error(`too many arguments — ${USAGE}`);
  }
  let payload: unknown;
  if (payloadJson !== undefined) {
    try {
      payload = JSON.parse(payloadJson);
    } catch (err) {
      throw new Error(
        `payload is not JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { baseUrl, tag, payload, timeoutMs };
}

export function rpcFor(tag: string): Rpc.AnyWithProps {
  const rpc = koluWireGroup.requests.get(tag);
  if (rpc === undefined) {
    const known = [...koluWireGroup.requests.keys()].sort().join("\n  ");
    throw new Error(
      `no member is served at tag "${tag}". Served tags:\n  ${known}`,
    );
  }
  return rpc as Rpc.AnyWithProps;
}

export async function runWireCall(argv: readonly string[]): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }
  let rpc: Rpc.AnyWithProps;
  let decoded: unknown;
  try {
    rpc = rpcFor(args.tag);
    decoded = Schema.decodeUnknownSync(
      rpc.payloadSchema as unknown as Schema.Codec<unknown, unknown>,
    )(args.payload);
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }

  const link = await websocketLink({
    group: koluWireGroup,
    url: () => surfaceWsUrl(args.baseUrl),
    isTerminalClose: isStaleProcessClose,
  });
  try {
    const exit = await Effect.runPromiseExit(
      link.dispatch.unary(args.tag, decoded),
      {
        signal: AbortSignal.timeout(args.timeoutMs),
      },
    );
    if (Exit.isFailure(exit)) {
      const cause: Cause.Cause<unknown> = exit.cause;
      die(
        Cause.hasInterrupts(cause)
          ? `${args.tag}: timed out after ${args.timeoutMs}ms`
          : `${args.tag}: ${Cause.pretty(cause)}`,
      );
    }
    const encoded = Schema.encodeUnknownSync(
      rpc.successSchema as unknown as Schema.Codec<unknown, unknown>,
    )(exit.value);
    process.stdout.write(`${JSON.stringify(encoded ?? null)}\n`);
  } finally {
    await link.dispose();
  }
}
