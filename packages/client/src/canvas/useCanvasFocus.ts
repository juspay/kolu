import { useTerminalStore } from "../terminal/useTerminalStore";

export function useCanvasFocus() {
  const store = useTerminalStore();
  return {
    request: store.centerActiveRequest,
  } as const;
}
