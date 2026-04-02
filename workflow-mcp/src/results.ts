import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as toYaml } from "yaml";
import type { Session } from "./schema.js";

export function writeResults(baseDir: string, session: Session): string {
  const dir = join(baseDir, session.id);
  mkdirSync(dir, { recursive: true });

  const data = {
    workflow: session.workflowName,
    entryPoint: session.entryPoint,
    input: session.input,
    startedAt: session.startedAt,
    status: session.status,
    haltReason: session.haltReason,
    steps: session.history.map((step) => ({
      nodeId: step.nodeId,
      visit: step.visit,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      evidence: step.evidence,
      edgeTaken: step.edgeTaken,
    })),
  };

  const filePath = join(dir, "results.yaml");
  writeFileSync(filePath, toYaml(data), "utf-8");
  return filePath;
}
