/**
 * Drain budget memory — the anti-livelock state that lives inside the supervisor for
 * one boot and **survives adopts**.
 *
 * Public handles are **opaque** (no `admit` / dual `drainBudget` on the type).
 * Enactment reaches internals via package-owned storage keyed by the handle.
 *
 * Instance keys are {@link InstanceKey}: named instances or `pre-instance`.
 */

import type { DaemonBuild } from "@kolu/surface-daemon";
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
  admit(lineage: DrainLineage, axisHint: string): DrainAdmission;
  readonly policy: ConvergencePolicy<"drainable"> | ConnectorPolicy;
};

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
  const drainedLineages = new Set<string>();
  const drainedInstanceByBuild = new Map<string, InstanceKey>();
  const attemptsByLineage = new Map<string, number>();

  const handle = { [budgetBrand]: true as const };
  BUDGET_INTERNALS.set(handle, {
    policy,
    admit(lineage, axisHint) {
      const lkey = lineageKey(lineage);
      const bkey = buildKey(lineage.build);

      const priorDrained = drainedInstanceByBuild.get(bkey);
      if (priorDrained !== undefined && !drainedLineages.has(lkey)) {
        return {
          kind: "giveUp",
          why: "cross-supervisor",
          drained: priorDrained,
          observed: lineage.instanceKey,
          axisHint,
        };
      }

      const attempts = attemptsByLineage.get(lkey) ?? 0;
      if (attempts >= drainBudget.maxAttempts) {
        return {
          kind: "giveUp",
          why: "budget",
          axisHint,
          attempts,
          maxAttempts: drainBudget.maxAttempts,
          instanceKey: lineage.instanceKey,
        };
      }

      const next = attempts + 1;
      attemptsByLineage.set(lkey, next);
      drainedLineages.add(lkey);
      drainedInstanceByBuild.set(bkey, lineage.instanceKey);
      return { kind: "drain", attempt: next };
    },
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
