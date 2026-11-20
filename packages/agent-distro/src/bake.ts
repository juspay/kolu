import { Schema } from "effect";

const NonEmpty = Schema.String.check(Schema.isMinLength(1));

/** Upstream's update schedule, in seconds (agent-distro's `lib.schedule`:
 *  `updatePeriodSeconds`, `updateOffsetSeconds` — four runs a day, at
 *  02/08/14/20 UTC). Kolu never decides it. */
export const UpdaterScheduleSchema = Schema.Struct({
  periodSeconds: Schema.Number.check(Schema.isGreaterThan(0)),
  offsetSeconds: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type UpdaterSchedule = typeof UpdaterScheduleSchema.Type;

const AgentDistroHostStateSchema = Schema.Struct({
  stateHomePlaceholder: NonEmpty,
  /** The package's state directory: its `current` and `last-success`. */
  state: NonEmpty,
  /** Upstream's history log, shared with its own updater. */
  history: NonEmpty,
  /** kolu's record of the set that landed: the package and the profiles
   *  delivered with it (`./landing.ts`). */
  landed: NonEmpty,
});

export type AgentDistroHostState = typeof AgentDistroHostStateSchema.Type;

/** Parse the host state. Throws on one that is not the Nix half's shape — a
 *  broken build, never a state to degrade from. */
export function parseAgentDistroHostState(text: string): AgentDistroHostState {
  return Schema.decodeUnknownSync(AgentDistroHostStateSchema)(JSON.parse(text));
}

const AgentDistroDeliverySchema = Schema.Struct({
  /** The flake the index publishes (`github:<repo>`, from `lib.caIndex`):
   *  kolu-server builds each profile with `lib.mkProfile` from it, at the
   *  revision the host's package was published at. */
  flake: NonEmpty,
  /** The raw base URL of upstream's content-addressed index (`lib.caIndex`'s
   *  `rawBase`, read by `@kolu/surface-remote`'s `readPublishedClosure`). */
  index: NonEmpty,
  /** The one binary cache every host pulls the package's closure from, and
   *  its signing key — what a host sent the signed package (a Mac, or Linux on
   *  Nix 2.35 or newer) trusts it by; a content-addressed one needs none. The
   *  cache holds the WHOLE closure of every path the index names, so a host
   *  reads no other cache: `nix copy --from` stops at the first path it
   *  lacks. */
  cache: Schema.Struct({ url: NonEmpty, publicKey: NonEmpty }),
  schedule: UpdaterScheduleSchema,
});

export type AgentDistroDelivery = typeof AgentDistroDeliverySchema.Type;

/** Parse the delivery. Throws on one that is not the Nix half's shape. */
export function parseAgentDistroDelivery(text: string): AgentDistroDelivery {
  return Schema.decodeUnknownSync(AgentDistroDeliverySchema)(JSON.parse(text));
}
