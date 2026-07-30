export interface BaselineSample {
  platform: "linux" | "darwin";
  runId: string;
  sha: string;
  e2eMs: number;
  unitMs: number;
  daemonMs: number;
  criticalPathMs: number;
  attempts: number;
  retries: number;
}

export interface Distribution {
  median: number;
  q1: number;
  q3: number;
  iqr: number;
}

export interface BaselineSummary {
  schemaVersion: 1;
  platforms: Array<{
    platform: "linux" | "darwin";
    samples: number;
    e2eMs: Distribution;
    unitMs: Distribution;
    daemonMs: Distribution;
    criticalPathMs: Distribution;
    attempts: Distribution;
    retries: Distribution;
  }>;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) throw new Error("cannot summarize an empty sample");
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

export function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("baseline values must be finite and non-negative");
  }
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted.slice(0, middle);
  const upper = sorted.slice(sorted.length % 2 === 0 ? middle : middle + 1);
  const q1 = median(lower.length > 0 ? lower : sorted);
  const q3 = median(upper.length > 0 ? upper : sorted);
  return { median: median(sorted), q1, q3, iqr: q3 - q1 };
}

export function summarizeBaseline(samples: BaselineSample[]): BaselineSummary {
  const runIds = new Set<string>();
  for (const sample of samples) {
    if (runIds.has(sample.runId))
      throw new Error(`duplicate runId ${sample.runId}`);
    runIds.add(sample.runId);
  }
  return {
    schemaVersion: 1,
    platforms: (["linux", "darwin"] as const).map((platform) => {
      const selected = samples.filter((sample) => sample.platform === platform);
      if (selected.length < 5) {
        throw new Error(
          `${platform}: need at least 5 samples, found ${selected.length}`,
        );
      }
      return {
        platform,
        samples: selected.length,
        e2eMs: distribution(selected.map((sample) => sample.e2eMs)),
        unitMs: distribution(selected.map((sample) => sample.unitMs)),
        daemonMs: distribution(selected.map((sample) => sample.daemonMs)),
        criticalPathMs: distribution(
          selected.map((sample) => sample.criticalPathMs),
        ),
        attempts: distribution(selected.map((sample) => sample.attempts)),
        retries: distribution(selected.map((sample) => sample.retries)),
      };
    }),
  };
}
