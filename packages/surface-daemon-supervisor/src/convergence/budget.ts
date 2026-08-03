/**
 * Drain budget memory — the anti-livelock state that lives inside the supervisor for
 * one boot and **survives adopts**.
 *
 * Public handles are **opaque** (no `admit` / dual `drainBudget` on the type).
 * Enactment reaches internals via package-owned storage keyed by the handle.
 *
 * The memory itself is one {@link Ref} over an immutable {@link BudgetMemory},
 * transitioned by the pure {@link admitAgainst} under {@link Ref.modify}, so an
 * admission is one atomic step rather than three separate writes to three
 * mutable containers.
 *
 * Instance keys are {@link InstanceKey}: named instances or `pre-instance`.
 */

import type { DaemonBuild } from "@kolu/surface-daemon";
import { type Effect, Ref } from "effect";
import type {
  ConnectorPolicy,
  ConvergencePolicy,
  DrainBudget,
} from "./policy.ts";
import { type InstanceKey, instanceKeyTag } from "./instanceKey.ts";

/** A running daemon's budget identity — build + instance key. */
export type DrainLineage = {
  readonly build: DaemonBuild;
  readonly instanceKey: InstanceKey;
};

/** Typed give-up evidence — not a free-form reason string alone. */
export type DrainGiveUp =
  | {
      readonly kind: "giveUp";
      readonly why: "budget";
      readonly axisHint: string;
      readonly attempts: number;
      readonly maxAttempts: number;
      readonly instanceKey: InstanceKey;
    }
  | {
      readonly kind: "giveUp";
      readonly why: "cross-supervisor";
      readonly drained: InstanceKey;
      readonly observed: InstanceKey;
      readonly axisHint: string;
    };

/** Admission verdict for one drain attempt. */
export type DrainAdmission =
  | { readonly kind: "drain"; readonly attempt: number }
  | DrainGiveUp;

const budgetBrand = Symbol("DrainBudgetHandle");

/**
 * Opaque public handle — no `admit` method on the type. Created only by
 * {@link createDrainBudget} / {@link createConnectorDrainBudget}.
 */
export type DrainBudgetHandle = {
  readonly [budgetBrand]: true;
};

/** Connector-arm budget — type-level pin for {@link convergeAdmit}. */
export type ConnectorDrainBudget = DrainBudgetHandle & {
  readonly __connectorPolicy: true;
};

type BudgetInternal = {
  admit(lineage: DrainLineage, axisHint: string): Effect.Effect<DrainAdmission>;
  readonly policy: ConvergencePolicy<"drainable"> | ConnectorPolicy;
};

/**
 * The handle → internals table.
 *
 * It stays a `WeakMap`, and that is a verdict rather than an oversight. This is
 * not the budget's volatile state — that lives in the three {@link Ref}s
 * {@link mintBudget} creates — it is the **unforgeable-handle brand table**: the
 * mechanism that makes `DrainBudgetHandle` opaque, so `admit` is unspellable on
 * the public type (F7). A `Ref` cannot be weak, so turning this into one would
 * retain every budget ever minted for the life of the process, keyed by a handle
 * whose owner is long gone.
 */
const BUDGET_INTERNALS = new WeakMap<DrainBudgetHandle, BudgetInternal>();

/** Package-internal: resolve a handle (throws if forged). Not a public export. */
export function budgetInternal(handle: DrainBudgetHandle): BudgetInternal {
  const inner = BUDGET_INTERNALS.get(handle);
  if (inner === undefined) {
    throw new Error(
      "DrainBudgetHandle is not from createDrainBudget — use the kit factory",
    );
  }
  return inner;
}

/** Package-internal: drainBudget field from a genuine handle. */
export function drainBudgetOf(handle: DrainBudgetHandle): DrainBudget {
  return budgetInternal(handle).policy.drainBudget;
}

/**
 * Package-internal: policy from a genuine handle.
 * Connector budgets are typed so callers get {@link ConnectorPolicy}.
 */
export function policyOf(handle: ConnectorDrainBudget): ConnectorPolicy;
export function policyOf(
  handle: DrainBudgetHandle,
): ConvergencePolicy<"drainable"> | ConnectorPolicy;
export function policyOf(
  handle: DrainBudgetHandle,
): ConvergencePolicy<"drainable"> | ConnectorPolicy {
  return budgetInternal(handle).policy;
}

function lineageKey(lineage: DrainLineage): string {
  return `${buildKey(lineage.build)}\0${instanceKeyTag(lineage.instanceKey)}`;
}

function buildKey(build: DaemonBuild): string {
  switch (build.kind) {
    case "known":
      return `known:${build.id}`;
    case "off-nix":
      return "off-nix";
    default: {
      const _exhaustive: never = build;
      throw new Error(
        `unreachable DaemonBuild: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/** Everything one budget remembers, as a value. */
type BudgetMemory = {
  /** Lineages this supervisor has itself drained. */
  readonly drainedLineages: ReadonlySet<string>;
  /** Per build, the ONE instance this supervisor drained — the cross-supervisor
   *  witness: a different instance of a build we already drained means someone
   *  else is respawning it. */
  readonly drainedInstanceByBuild: ReadonlyMap<string, InstanceKey>;
  /** Attempts spent per lineage. */
  readonly attemptsByLineage: ReadonlyMap<string, number>;
};

const EMPTY_MEMORY: BudgetMemory = {
  drainedLineages: new Set(),
  drainedInstanceByBuild: new Map(),
  attemptsByLineage: new Map(),
};

/**
 * The admission rule, as a pure transition: memory in, verdict + next memory
 * out. Keeping it a function of the two inputs is what lets {@link Ref.modify}
 * apply it as ONE step — a give-up can never be decided against memory a
 * concurrent enactment has already moved past, and the three writes of an
 * admitted drain can never be observed half-applied.
 */
function admitAgainst(
  memory: BudgetMemory,
  budget: DrainBudget,
  lineage: DrainLineage,
  axisHint: string,
): readonly [DrainAdmission, BudgetMemory] {
  const lkey = lineageKey(lineage);
  const bkey = buildKey(lineage.build);

  const priorDrained = memory.drainedInstanceByBuild.get(bkey);
  if (priorDrained !== undefined && !memory.drainedLineages.has(lkey)) {
    return [
      {
        kind: "giveUp",
        why: "cross-supervisor",
        drained: priorDrained,
        observed: lineage.instanceKey,
        axisHint,
      },
      memory,
    ];
  }

  const attempts = memory.attemptsByLineage.get(lkey) ?? 0;
  if (attempts >= budget.maxAttempts) {
    return [
      {
        kind: "giveUp",
        why: "budget",
        axisHint,
        attempts,
        maxAttempts: budget.maxAttempts,
        instanceKey: lineage.instanceKey,
      },
      memory,
    ];
  }

  const next = attempts + 1;
  return [
    { kind: "drain", attempt: next },
    {
      drainedLineages: new Set(memory.drainedLineages).add(lkey),
      drainedInstanceByBuild: new Map(memory.drainedInstanceByBuild).set(
        bkey,
        lineage.instanceKey,
      ),
      attemptsByLineage: new Map(memory.attemptsByLineage).set(lkey, next),
    },
  ];
}

function mintBudget(
  policy: ConvergencePolicy<"drainable"> | ConnectorPolicy,
): DrainBudgetHandle {
  const drainBudget = policy.drainBudget;
  if (
    !Number.isInteger(drainBudget.maxAttempts) ||
    drainBudget.maxAttempts < 1
  ) {
    throw new Error(
      `drainBudget.maxAttempts must be a positive integer, got ${drainBudget.maxAttempts}`,
    );
  }
  const memory = Ref.makeUnsafe<BudgetMemory>(EMPTY_MEMORY);

  const handle = { [budgetBrand]: true as const };
  BUDGET_INTERNALS.set(handle, {
    policy,
    admit: (lineage, axisHint) =>
      Ref.modify(memory, (m) =>
        admitAgainst(m, drainBudget, lineage, axisHint),
      ),
  });
  return handle;
}

/**
 * Endpoint-arm budget — any drainable {@link ConvergencePolicy}.
 */
export function createDrainBudget(
  policy: ConvergencePolicy<"drainable">,
): DrainBudgetHandle {
  return mintBudget(policy);
}

/**
 * Connector-arm budget — only {@link ConnectorPolicy} (unspellable recycle /
 * nudge-human). The only handle {@link convergeAdmit} accepts.
 */
export function createConnectorDrainBudget(
  policy: ConnectorPolicy,
): ConnectorDrainBudget {
  return mintBudget(policy) as ConnectorDrainBudget;
}
