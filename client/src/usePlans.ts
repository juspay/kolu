/** Plan state — active plan selection, content fetching, and feedback mutation. */

import { type Accessor, createSignal, createMemo, createEffect, on } from "solid-js";
import { createQuery, createMutation, useQueryClient } from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import { orpc } from "./orpc";
import { useTips } from "./useTips";
import { CONTEXTUAL_TIPS } from "./tips";
import type { PlanFile, PlanContent, TerminalMetadata } from "kolu-common";

/** Singleton state — created once, cached at module level. */
let cached: ReturnType<typeof createPlansState> | null = null;

function createPlansState() {
  const [activePlanPath, setActivePlanPath] = createSignal<string | null>(null);

  return { activePlanPath, setActivePlanPath };
}

export function usePlans(deps?: {
  activeMeta: Accessor<TerminalMetadata | null>;
}) {
  if (!cached) cached = createPlansState();
  const { activePlanPath, setActivePlanPath } = cached;

  /** All plan files from the active terminal's metadata. */
  const plans = createMemo((): PlanFile[] => {
    return deps?.activeMeta()?.plans ?? [];
  });

  /** Fetch content of the active plan. */
  const planContent = createQuery(() => {
    const p = activePlanPath();
    return {
      ...orpc.plans.get.queryOptions({ input: { path: p! } }),
      enabled: !!p,
      // Refetch frequently since plan files change while Claude generates
      staleTime: 2_000,
    };
  });

  /** Mutation to add feedback to a plan. */
  const qc = useQueryClient();
  const addFeedbackMut = createMutation(() => ({
    ...orpc.plans.addFeedback.mutationOptions(),
    onSuccess: () => {
      // Refetch the plan content after feedback is added
      const p = activePlanPath();
      if (p) {
        void qc.invalidateQueries({
          queryKey: orpc.plans.get.queryOptions({ input: { path: p } }).queryKey,
        });
      }
      toast.success("Feedback added to plan");
    },
    onError: (err: Error) => toast.error(`Failed to add feedback: ${err.message}`),
  }));

  // Notify when new plans appear
  const { showTipOnce } = useTips();
  let knownPaths = new Set<string>();
  createEffect(
    on(plans, (current) => {
      const currentPaths = new Set(current.map((p) => p.path));
      // Find plans that are new (not previously known)
      for (const plan of current) {
        if (!knownPaths.has(plan.path)) {
          // Only notify if we had some previous state (not initial load)
          if (knownPaths.size > 0) {
            toast(`New plan: ${plan.name}`, {
              action: {
                label: "View",
                onClick: () => openPlan(plan.path),
              },
              duration: 8_000,
            });
          }
        }
      }
      knownPaths = currentPaths;
      // Show tip on first plan detection
      if (current.length > 0) showTipOnce(CONTEXTUAL_TIPS.plans);
    }),
  );

  function openPlan(path: string) {
    setActivePlanPath(path);
  }

  function closePlan() {
    setActivePlanPath(null);
  }

  function addFeedback(path: string, afterLine: number, text: string) {
    addFeedbackMut.mutate({ path, afterLine, text });
  }

  return {
    plans,
    activePlanPath,
    planContent: () => planContent.data as PlanContent | undefined,
    isPlanContentLoading: () => planContent.isLoading,
    openPlan,
    closePlan,
    addFeedback,
  };
}
