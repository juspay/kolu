import { toError } from "./toError";

export const safeApply = (fn: () => void, onError: (err: Error) => void) => {
  try {
    fn();
  } catch (e) {
    onError(toError(e));
  }
};
