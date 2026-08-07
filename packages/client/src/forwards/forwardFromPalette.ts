/**
 * The ⌘K "Forward a port…" target — parsing what a human types, and doing it.
 *
 * Lives here rather than inline in `commands.tsx` because it is a parse plus an
 * async call plus its error handling, and the palette registry stays a registry
 * (`.claude/rules/solidjs.md`: commands call a handler, they do not contain one).
 *
 * The input is `host:port`, or a bare port meaning the host you are looking at.
 * The host must be one kolu already has, and that is a real restriction rather
 * than an oversight: every surface that shows forwards is host-scoped (the
 * Inspector group, the host tab's dropdown and its `⇄ n` badge), so a forward to
 * a machine with no host tab would be a live listener with nowhere to see or
 * cancel it. Refusing loudly beats opening a door that appears in no list.
 */

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

/** Parse `host:port` / `port` against the hosts kolu actually has.
 *
 *  The TOKENIZING is `@kolu/port-forward`'s `splitHostPort` — the same one
 *  `parseTarget` runs, so "what a human types as host:port" has one reader and
 *  the last-colon rule is not restated here. What stays is kolu's POLICY: an
 *  unnamed host means the host you are looking at (which may be remote), and a
 *  named one must be in kolu's pool. */
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

  // No host named: the one you are looking at. That is the common case (a port
  // on the machine whose terminals are on screen) and saves typing its name.
  if (hostText === "") return { ok: true, host: activeHost, port };

  // `parseHostInput` is the repo's codec for HUMAN host input — the add-host
  // picker and a `KOLU_PADI_HOST` seed already read through it — and
  // `hostKeysInclude` is its membership authority. Reading them here rather than
  // matching by hand is not tidiness: the set of spellings that name the local
  // host lives in that codec BECAUSE a second reader knowing only some of them
  // mints a divergent answer, which is the bug the set was introduced for. The
  // hand-rolled version had already lost `127.0.0.1` and `::1`, so those were
  // refused here while every other surface resolved them.
  //
  // It also inherits the judgment this file should not be re-making: a
  // `user@localhost` is ssh as a different user to the loopback, which is its
  // own remote target rather than the local default.
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
  // An empty field is not an error while the user is still typing; it just
  // cannot be submitted, which the palette handles by refusing empty values.
  if (raw.trim() === "") return null;
  const parsed = parseForwardInput(raw, hosts, activeHost);
  return parsed.ok ? null : parsed.message;
}

/** Submit. `manual`, because the user named this target: kolu is watching no
 *  listener on their behalf here — the port may be one no scanner can see — so
 *  nothing but an explicit cancel (or the host leaving) may close it. */
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
  // Compose the shared act layer — same `ensureDoor` the chip and the card use.
  // No `window.open`: the palette only opens a door, it does not load a page.
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

/** Exported for the unit test — the encoded form the parse matched on. */
export function encodedHostOf(input: ForwardInput): string | null {
  return input.ok ? encodeHostKey(input.host) : null;
}
