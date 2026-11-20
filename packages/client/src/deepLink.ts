import { Option, Result, Schema } from "effect";
import { isEncodedHostKey } from "kolu-common/hostKey";
import { type TerminalId, TerminalIdSchema } from "kolu-common/surface";
import { type WorkId, workKeyOf } from "kolu-work";
import { hashSegments } from "./hashPath";

const decodeTerminalId = Schema.decodeUnknownResult(TerminalIdSchema);

/** A fully-formed, ready-to-route navigation request. Every field is validated;
 *  the router acts on it without re-checking. `host` is the encoded key string. */
export type DeepLink =
  | { kind: "host"; host: string }
  | { kind: "terminal"; host: string; terminalId: TerminalId }
  | {
      kind: "code";
      host: string;
      terminalId: TerminalId;
      path: string;
      line: number | null;
    }
  | { kind: "inspector"; host: string; terminalId: TerminalId }
  | WorkRoute
  | { kind: "settings" };

export interface WorkRoute {
  readonly kind: "work";
  readonly work: WorkId;
  readonly ask: string | null;
}

/** A work route from parts read off the outside world — a link's segments,
 *  a notification's envelope — or why it is refused. The ONE check both
 *  apply: an id that names no work key is not a work, and an ask is a
 *  non-empty string. */
export function workRouteOf(
  work: unknown,
  ask: unknown,
): Result.Result<WorkRoute, string> {
  if (typeof work !== "string" || Option.isNone(workKeyOf(work)))
    return Result.fail(`not a work id: ${String(work)}`);
  if (ask !== null && (typeof ask !== "string" || ask === ""))
    return Result.fail(`not a question id: ${String(ask)}`);
  return Result.succeed({ kind: "work", work, ask });
}

export const workLink = (work: WorkId, ask: string | null = null): string =>
  `#/work/${encodeURIComponent(work)}${
    ask === null ? "" : `/ask/${encodeURIComponent(ask)}`
  }`;

/** The parse verdict. `none` — no deep link present (empty/bare hash, the normal
 *  app load): the router does nothing, silently. `invalid` — a non-empty hash
 *  that isn't a known route (a typo, a future grammar): the router toasts + goes
 *  home, never silently ignoring a new link shape. */
export type ParsedDeepLink =
  | DeepLink
  | { kind: "none" }
  | { kind: "invalid"; reason: string };

const invalid = (reason: string): ParsedDeepLink => ({
  kind: "invalid",
  reason,
});

/** Parse a raw `location.hash` (with or without the leading `#`) into a verdict. */
export function parseDeepLink(hash: string): ParsedDeepLink {
  const read = hashSegments(hash);
  if (read.kind === "empty") return { kind: "none" };
  if (read.kind === "bad") return invalid(read.reason);
  const queryPart = read.query;

  const [family, ...rest] = read.segments;

  if (family === "settings") {
    if (rest.length !== 0)
      return invalid("#/settings takes no further segments");
    return { kind: "settings" };
  }

  if (family === "work") {
    const [work, word, ask] = rest;
    if (
      !(rest.length === 1 || (rest.length === 3 && word === "ask")) ||
      work === undefined
    )
      return invalid("#/work expects <workId> or <workId>/ask/<askId>");
    const route = workRouteOf(work, ask ?? null);
    return Result.isFailure(route) ? invalid(route.failure) : route.success;
  }

  if (family === "h") {
    const host = rest[0];
    if (rest.length !== 1 || host === undefined)
      return invalid("#/h expects exactly one <host> segment");
    if (!isEncodedHostKey(host))
      return invalid(`not a canonical host key: ${host}`);
    return { kind: "host", host };
  }

  if (family === "t") {
    const host = rest[0];
    const idSegment = rest[1];
    if (rest.length < 2 || host === undefined || idSegment === undefined)
      return invalid("#/t expects <host>/<terminalId>");
    if (!isEncodedHostKey(host))
      return invalid(`not a canonical host key: ${host}`);
    const parsedId = decodeTerminalId(idSegment);
    if (Result.isFailure(parsedId))
      return invalid(`not a terminal UUID: ${idSegment}`);
    const terminalId = parsedId.success;

    if (rest.length === 2) return { kind: "terminal", host, terminalId };

    const tab = rest[2];
    if (rest.length > 3 || tab === undefined)
      return invalid("unexpected segments after /code or /inspector");

    if (tab === "inspector") return { kind: "inspector", host, terminalId };

    if (tab === "code") {
      const params = new URLSearchParams(queryPart);
      const path = params.get("path");
      if (path === null || path === "")
        return invalid("#/t/…/code requires a ?path=");
      const lineRaw = params.get("line");
      let line: number | null = null;
      if (lineRaw !== null) {
        const n = Number(lineRaw);
        if (!/^[0-9]+$/.test(lineRaw) || !Number.isSafeInteger(n) || n < 1) {
          return invalid(`?line must be a positive integer: ${lineRaw}`);
        }
        line = n;
      }
      return { kind: "code", host, terminalId, path, line };
    }

    return invalid(`unknown terminal sub-route: ${tab}`);
  }

  return invalid(`unknown route family: ${family}`);
}
