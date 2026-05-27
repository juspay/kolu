/** Pierre's imperative methods (`render`, `resetPaths`, `setSelectedLines`,
 *  …) can throw on malformed input or asset load failure. Every Solid wrapper
 *  in this package routes those throws through the consumer's `onError` prop
 *  so silent failures can't escape into a blank pane. The pattern is one
 *  `try { fn(); } catch (e) { onError(toError(e)); }` per call site —
 *  centralised here so the four wrappers stay uniform and a future
 *  error-routing change (e.g. structured error envelopes) lands in one
 *  file. */

import { toError } from "./toError";

export const safeApply = (fn: () => void, onError: (err: Error) => void) => {
  try {
    fn();
  } catch (e) {
    onError(toError(e));
  }
};
