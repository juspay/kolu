/**
 * The two files `default.nix` bakes for agent-distro besides the floor — their
 * schemas and parsers, so padi and kolu-server read one definition:
 *
 *   - the HOST STATE (both arms, `KOLU_AGENT_DISTRO_STATE`): where a host keeps
 *     what kolu delivered it — the package's state directory (agent-distro's
 *     own `stateDirectory` for its one package, whose `current` padi points at
 *     the package that landed), the history log upstream's updater writes too,
 *     and kolu's record of the profiles that landed with it — each written
 *     against a placeholder home padi makes concrete (`./bundle.ts`'
 *     `concreteStatePath`);
 *   - the DELIVERY (the binder's arm only, `KOLU_AGENT_DISTRO_DELIVERY`):
 *     upstream's content-addressed index kolu-server reads the package's path
 *     off (`@kolu/surface-remote`'s `readPublishedClosure`, its `latest/`
 *     entries), the one binary cache every host pulls that path from
 *     (`lib.cache`: URL and the key a Mac trusts the signed package by), and
 *     upstream's update schedule (`lib.schedule`).
 *
 * Pure: the readers of the environment and the files stay where they run.
 */

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
   *  its signing key — what a Mac must trust to take the signed package (a
   *  content-addressed one needs none). */
  cache: Schema.Struct({ url: NonEmpty, publicKey: NonEmpty }),
  schedule: UpdaterScheduleSchema,
});

export type AgentDistroDelivery = typeof AgentDistroDeliverySchema.Type;

/** Parse the delivery. Throws on one that is not the Nix half's shape. */
export function parseAgentDistroDelivery(text: string): AgentDistroDelivery {
  return Schema.decodeUnknownSync(AgentDistroDeliverySchema)(JSON.parse(text));
}
