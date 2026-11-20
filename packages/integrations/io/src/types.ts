/** The argv + environment a live pid was STARTED with. */
export interface ProcessSnapshot {
  argv: string[];
  /** The process's environment, or `null` when this platform cannot report it
   *  (macOS redacts even a same-user process's env). `null` and `{}` are
   *  DIFFERENT facts: "unreadable by policy" vs "started with no environment",
   *  and a consumer that resolves paths from env vars must know which one it is
   *  holding. */
  env: Record<string, string> | null;
}
