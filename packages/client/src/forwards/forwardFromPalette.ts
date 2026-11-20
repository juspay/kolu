import { splitHostPort } from "@kolu/port-forward/target";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import {
  encodeHostKey,
  type HostKey,
  hostKeysInclude,
  parseHostInput,
} from "kolu-common/hostKey";
import { toast } from "solid-sonner";
import type { UiAction } from "../runAction";
import { ensureDoor } from "./openPort";

/** A parsed palette target, or why it could not be one. */
export type ForwardInput =
  | { ok: true; host: HostKey; port: number }
  | { ok: false; message: string };

export function parseForwardInput(
  raw: string,
  hosts: readonly HostKey[],
  activeHost: HostKey,
): ForwardInput {
  const text = raw.trim();
  if (text === "") return { ok: false, message: "Type a port, or host:port." };

  const split = splitHostPort(text);
  if (!split.ok) {
    return {
      ok: false,
      message:
        split.reason === "not-a-tcp-port"
          ? `${split.port} is not a TCP port (1–65535).`
          : `"${text}" has no port number.`,
    };
  }
  const { port } = split;
  const hostText = split.host ?? "";

  if (hostText === "") return { ok: true, host: activeHost, port };

  const named = parseHostInput(hostText);
  if (hostKeysInclude(hosts, named)) return { ok: true, host: named, port };
  return {
    ok: false,
    message: `kolu has no host "${hostText}" — add it first, or use a bare port for ${labelOf(activeHost)}.`,
  };
}

function labelOf(host: HostKey): string {
  return host.kind === "local" ? "this machine" : host.target;
}

/** The palette's per-keystroke validator — the message under the input. */
export function forwardInputError(
  raw: string,
  hosts: readonly HostKey[],
  activeHost: HostKey,
): string | null {
  if (raw.trim() === "") return null;
  const parsed = parseForwardInput(raw, hosts, activeHost);
  return parsed.ok ? null : parsed.message;
}

export function forwardFromPalette(
  raw: string,
  hosts: readonly HostKey[],
  activeHost: HostKey,
): UiAction {
  const parsed = parseForwardInput(raw, hosts, activeHost);
  if (!parsed.ok) {
    return Effect.sync(() => {
      toast.error(parsed.message);
    });
  }
  return ensureDoor({
    host: parsed.host,
    port: parsed.port,
    origin: "manual",
  }).pipe(
    Effect.tap((localPort) =>
      Effect.sync(() => {
        toast.success(
          `Forwarding ${labelOf(parsed.host)}:${parsed.port} on port ${localPort}`,
        );
      }),
    ),
    Effect.catch((err) =>
      Effect.sync(() => {
        toast.error(
          `Could not forward ${labelOf(parsed.host)}:${parsed.port}: ${toError(err).message}`,
        );
      }),
    ),
  );
}

export function encodedHostOf(input: ForwardInput): string | null {
  return input.ok ? encodeHostKey(input.host) : null;
}
