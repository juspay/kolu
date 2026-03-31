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
  /** Plan info from the active terminal's Claude session. */
  const activePlanPath = createMemo(
    () => deps.activeMeta()?.claude?.latestPlanPath ?? null,
  );
  /** Plan file mtime — pushed by server on fs change, used in query key to trigger refetch. */
  const planModifiedAt = createMemo(
    () => deps.activeMeta()?.claude?.planModifiedAt ?? null,
  );

  /** Plan display name derived from file path. */
  const planName = createMemo(() => {
    const p = activePlanPath();
    if (!p) return "Plan";
    const filename = p.split("/").pop() ?? "Plan";
    return filename.replace(/\.md$/, "");
  });

  /** Fetch content of the active plan.
   *  The query key includes planModifiedAt so TanStack auto-refetches when the
   *  server pushes a new mtime via the metadata stream (no polling needed). */
  const planContent = createQuery(() => {
    const p = activePlanPath();
    const mtime = planModifiedAt();
    const opts = orpc.plans.get.queryOptions({ input: { path: p! } });
    return {
      ...opts,
      // Append mtime to the query key — when the server's fs watcher detects
      // a plan file change, it publishes updated metadata with a new mtime,
      // which changes this key, triggering a fresh fetch.
      queryKey: [...opts.queryKey, mtime],
      enabled: !!p,
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
