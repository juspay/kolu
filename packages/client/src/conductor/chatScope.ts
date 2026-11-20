import type { Work, WorkId } from "kolu-work";
import { batch, createSignal } from "solid-js";
import { conductorWide } from "./conductorLayout";
import { closeReader } from "./reader/useReader";
import { useWorkMap } from "./useWorks";
import { setListingOut } from "./workListing";

const [scope, setScope] = createSignal<WorkId | null>(null);

export const chatScope = (): {
  readonly id: WorkId;
  readonly record: Work;
} | null => {
  const id = scope();
  if (id === null) return null;
  const record = useWorkMap()().get(id);
  return record === undefined ? null : { id, record };
};

export function aboutWork(id: WorkId): void {
  batch(() => {
    closeReader();
    if (!conductorWide()) setListingOut(false);
    setScope(id);
  });
}

export function showAllChat(): void {
  setScope(null);
}
