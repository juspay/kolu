export type HydrationPhase = "pending" | "decided" | "seeded";

export interface HostRestoreLatch {
  readonly phase: HydrationPhase;
  markDecided(): void;
  markSeeded(): void;
  reseedForRestore(): void;
  readonly restoredActive: { readonly id: string | null } | null;
  reportRestoredActive(id: string | null): void;
  expireRestoredActive(): void;
}

export function createSessionRestore(): HostRestoreLatch {
  let phase: HydrationPhase = "pending";
  let restoredActive: { readonly id: string | null } | null = null;
  return {
    get phase() {
      return phase;
    },
    get restoredActive() {
      return restoredActive;
    },
    markDecided() {
      if (phase === "pending") phase = "decided";
    },
    markSeeded() {
      if (phase === "decided") {
        phase = "seeded";
        restoredActive = null;
      }
    },
    reseedForRestore() {
      if (phase === "seeded") phase = "decided";
    },
    reportRestoredActive(id: string | null) {
      restoredActive = { id };
    },
    expireRestoredActive() {
      restoredActive = null;
    },
  };
}
