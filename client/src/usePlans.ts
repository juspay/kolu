/** Plan state — derives active plan from Claude metadata, fetches content, handles feedback. */

import { type Accessor, createSignal, createEffect, on } from "solid-js";
import { toast } from "solid-sonner";
import { client } from "./rpc";
import type { PlanContent, TerminalMetadata } from "kolu-common";

export function usePlans(deps: {
  activeMeta: Accessor<TerminalMetadata | null>;
}) {
  /** Plan info from the active terminal's Claude session. */
  const activePlanPath = () =>
    deps.activeMeta()?.claude?.latestPlanPath ?? null;
  /** Plan file mtime — pushed by server on fs change, used to trigger refetch. */
  const planModifiedAt = () =>
    deps.activeMeta()?.claude?.planModifiedAt ?? null;

  /** Plan display name derived from file path. */
  const planName = () => {
    const p = activePlanPath();
    if (!p) return "Plan";
    const filename = p.split("/").pop() ?? "Plan";
    return filename.replace(/\.md$/, "");
  };

  const [planContent, setPlanContent] = createSignal<PlanContent | undefined>();
  const [isPlanContentLoading, setIsPlanContentLoading] = createSignal(false);

  // Refetch plan content when path or mtime changes
  createEffect(
    on(
      () => [activePlanPath(), planModifiedAt()] as const,
      ([p, _mtime]) => {
        if (!p) {
          setPlanContent(undefined);
          return;
        }
        setIsPlanContentLoading(true);
        client.plans
          .get({ path: p })
          .then((content) => {
            // Only update if the path still matches (guard against stale responses)
            if (activePlanPath() === p) {
              setPlanContent(content);
            }
          })
          .catch((err: Error) => {
            console.error("Failed to fetch plan content:", err);
            setPlanContent(undefined);
          })
          .finally(() => setIsPlanContentLoading(false));
      },
    ),
  );

  function addFeedback(path: string, afterLine: number, text: string) {
    client.plans
      .addFeedback({ path, afterLine, text })
      .then(() => {
        toast.success("Feedback added to plan");
        // Refetch content after adding feedback
        return client.plans.get({ path });
      })
      .then((content) => {
        if (activePlanPath() === path) {
          setPlanContent(content);
        }
      })
      .catch((err: Error) =>
        toast.error(`Failed to add feedback: ${err.message}`),
      );
  }

  function removeFeedback(path: string, feedbackLine: number) {
    client.plans
      .removeFeedback({ path, feedbackLine })
      .then(() => {
        // Refetch content after removing feedback
        return client.plans.get({ path });
      })
      .then((content) => {
        if (activePlanPath() === path) {
          setPlanContent(content);
        }
      })
      .catch((err: Error) =>
        toast.error(`Failed to remove feedback: ${err.message}`),
      );
  }

  return {
    activePlanPath,
    planName,
    planContent,
    isPlanContentLoading,
    addFeedback,
    removeFeedback,
  };
}
