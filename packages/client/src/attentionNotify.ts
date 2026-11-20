import { createNotify } from "@kolu/surface-app/notify";
import { Result, Schema } from "effect";
import { isEncodedHostKey } from "kolu-common/hostKey";
import { TerminalIdSchema } from "kolu-common/surface";
import { type WorkRoute, workRouteOf } from "./deepLink";

const EncodedHostKey = Schema.String.check(
  Schema.makeFilter((s) =>
    isEncodedHostKey(s) ? undefined : "not a canonical encoded host key",
  ),
);

const AttentionClickSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("conductor") }),
  Schema.Struct({
    kind: Schema.Literal("terminal"),
    host: EncodedHostKey,
    terminalId: TerminalIdSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("host"),
    host: EncodedHostKey,
    id: TerminalIdSchema,
  }),
]);

const WorkClickSchema = Schema.Struct({
  kind: Schema.Literal("work"),
  work: Schema.Unknown,
  ask: Schema.optionalKey(Schema.Unknown),
});

const decodeClick = Schema.decodeUnknownResult(AttentionClickSchema);
const decodeWorkClick = Schema.decodeUnknownResult(WorkClickSchema);

export type AttentionClick = typeof AttentionClickSchema.Type | WorkRoute;

function parseAttentionClick(data: unknown): AttentionClick | undefined {
  const click = decodeClick(data);
  if (Result.isSuccess(click)) return click.success;
  const work = decodeWorkClick(data);
  if (Result.isFailure(work)) return undefined;
  const route = workRouteOf(work.success.work, work.success.ask ?? null);
  return Result.isSuccess(route) ? route.success : undefined;
}

export const notify = createNotify<AttentionClick>(parseAttentionClick);
