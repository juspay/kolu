import { createRoot } from "solid-js";

export function createSharedRoot<T>(factory: () => T): () => T {
  let box: { value: T } | undefined;
  return () => {
    if (!box) {
      box = { value: createRoot(factory) };
    }
    return box.value;
  };
}
