/** Plan state — derives active plan from Claude metadata, fetches content, handles feedback. */

import { type Accessor, createMemo } from "solid-js";
import {
  createQuery,
  createMutation,
  useQueryClient,
} from "@tanstack/solid-query";
import { toast } from "solid-sonner";
import { orpc } from "./orpc";
import type { PlanContent, TerminalMetadata } from "kolu-common";

export function usePlans(deps: {
  activeMeta: Accessor<TerminalMetadata | null>;
}) {
  /** Path to the latest plan from the active terminal's Claude session. */
  const activePlanPath = createMemo(
    () => deps.activeMeta()?.claude?.latestPlanPath ?? null,
  );

  /** Plan display name derived from file path. */
  const planName = createMemo(() => {
    const p = activePlanPath();
    if (!p) return "Plan";
    const filename = p.split("/").pop() ?? "Plan";
    return filename.replace(/\.md$/, "");
  });

  /** Fetch content of the active plan. */
  const planContent = createQuery(() => {
    const p = activePlanPath();
    return {
      ...orpc.plans.get.queryOptions({ input: { path: p! } }),
      enabled: !!p,
      // Poll for content changes — the file may be updated by Claude mid-session.
      // staleTime prevents redundant fetches; refetchInterval ensures we pick up
      // file changes even when the plan path hasn't changed in metadata.
      staleTime: 2_000,
      refetchInterval: 3_000,
    };
  });

  /** Mutation to add feedback to a plan. */
  const qc = useQueryClient();
  const addFeedbackMut = createMutation(() => ({
    ...orpc.plans.addFeedback.mutationOptions(),
    onSuccess: () => {
      const p = activePlanPath();
      if (p) {
        void qc.invalidateQueries({
          queryKey: orpc.plans.get.queryOptions({ input: { path: p } })
            .queryKey,
        });
      }
      toast.success("Feedback added to plan");
    },
    onError: (err: Error) =>
      toast.error(`Failed to add feedback: ${err.message}`),
  }));

  function addFeedback(path: string, afterLine: number, text: string) {
    addFeedbackMut.mutate({ path, afterLine, text });
  }

  return {
    activePlanPath,
    planName,
    planContent: () => planContent.data as PlanContent | undefined,
    isPlanContentLoading: () => planContent.isLoading,
    addFeedback,
  };
}
