import { Schema } from "effect";
import { notAFleetRef, splitFleetTerminalRef } from "./ref.ts";

export const FleetTerminalRefSchema = Schema.String.check(
  Schema.makeFilter((ref: string) =>
    splitFleetTerminalRef(ref) === null ? notAFleetRef(ref) : undefined,
  ),
).annotate({
  description:
    "A terminal on this fleet: <host>/<id> — a host key from the `hosts` resource, a slash, and the terminal id.",
});

export const FleetHostKeySchema = Schema.String.check(
  Schema.isMinLength(1),
).annotate({
  description:
    "Which host, by its key from the `hosts` resource (`local`, or `remote:<target>`).",
});
