/**
 * The two files `default.nix` bakes for agent-distro besides the floor — their
 * schemas and parsers, so padi and kolu-server read one definition:
 *
 *   - the PROFILES listing (both arms, `KOLU_AGENT_DISTRO_PROFILES`): every
 *     profile this build knows, in listing order (the default first), each
 *     with the state directory a host keeps it under (agent-distro's own
 *     `stateDirectory`, written against a placeholder home padi makes concrete
 *     — `./bundle.ts`' `concreteStatePath`), and the history log;
 *   - the DELIVERY (the binder's arm only, `KOLU_AGENT_DISTRO_DELIVERY`):
 *     upstream's flake kolu-server locks once per run, the one binary cache it
 *     copies bundles out of (`lib.cache`: URL and public key), and upstream's
 *     update schedule (`lib.schedule`).
 *
 * Pure: the readers of the environment and the files stay where they run.
 */

import { Schema } from "effect";
import { UpdaterScheduleSchema } from "./schedule.ts";

const NonEmpty = Schema.String.check(Schema.isMinLength(1));

const AgentDistroProfilesSchema = Schema.Struct({
  stateHomePlaceholder: NonEmpty,
  history: NonEmpty,
  profiles: Schema.Array(
    Schema.Struct({ name: NonEmpty, state: NonEmpty }),
  ).check(Schema.isMinLength(1)),
});

export type AgentDistroProfiles = typeof AgentDistroProfilesSchema.Type;

/** Parse the profiles listing. Throws on one that is not the Nix half's shape
 *  — a broken build, never a state to degrade from. */
export function parseAgentDistroProfiles(text: string): AgentDistroProfiles {
  return Schema.decodeUnknownSync(AgentDistroProfilesSchema)(JSON.parse(text));
}

const AgentDistroDeliverySchema = Schema.Struct({
  /** Upstream's flake (`github:juspay/agent-distro`), locked once per run. */
  flake: NonEmpty,
  /** The one binary cache bundles are copied out of, and its key. */
  cache: Schema.Struct({ url: NonEmpty, publicKey: NonEmpty }),
  schedule: UpdaterScheduleSchema,
});

export type AgentDistroDelivery = typeof AgentDistroDeliverySchema.Type;

/** Parse the delivery. Throws on one that is not the Nix half's shape. */
export function parseAgentDistroDelivery(text: string): AgentDistroDelivery {
  return Schema.decodeUnknownSync(AgentDistroDeliverySchema)(JSON.parse(text));
}
