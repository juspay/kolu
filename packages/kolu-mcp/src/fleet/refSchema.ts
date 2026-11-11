/**
 * The fleet grammar as WIRE SCHEMAS — the half of `./ref.ts` that costs an
 * effect import.
 *
 * Split from the grammar itself for the reason that file's header states: the
 * parser is reached by `@kolu/acp-harness`, whose manifest carries neither
 * effect nor this package's MCP chain. Everything here is `@kolu/surface` and
 * MCP vocabulary — a decoder, and the blurb an agent reads in `tools/list`.
 *
 * The check is the GRAMMAR's own predicate, not a second regexp: a malformed
 * reference is refused by the DECODER at the adapter's one `tools/call` edge,
 * before any handler runs, and the issue it carries is the grammar's own
 * sentence ({@link notAFleetRef}), which is what every tool's refusal says too.
 */

import { Schema } from "effect";
import { notAFleetRef, splitFleetTerminalRef } from "./ref.ts";

/** A terminal on the fleet, as a wire value. */
export const FleetTerminalRefSchema = Schema.String.check(
  Schema.makeFilter((ref: string) =>
    splitFleetTerminalRef(ref) === null ? notAFleetRef(ref) : undefined,
  ),
).annotate({
  description:
    "A terminal on this fleet: <host>/<id> — a host key from the `hosts` resource, a slash, and the terminal id.",
});

/** The encoded host key, as a wire value. Opaque: the fleet face compares it
 *  and never decodes it, so the only rule is that it is not empty. */
export const FleetHostKeySchema = Schema.String.check(
  Schema.isMinLength(1),
).annotate({
  description:
    "Which host, by its key from the `hosts` resource (`local`, or `remote:<target>`).",
});
