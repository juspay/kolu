import type { SharedArtifact } from "./sharedArtifact.ts";

// @ts-expect-error — a versioned artifact must declare the version+1 reader
// disposition that its executed proof will be checked against.
const versionedWithoutDisposition: SharedArtifact = {
  id: "state-config",
  pathShape: "<stateRoot>/config.json",
  role: "config",
  coveredByTest: "state-config.test.ts",
  versionField: "formatVersion",
  diskBasenames: ["config.json"],
  diskBasenamePatterns: [],
  why: "Compile-fail fixture.",
};

void versionedWithoutDisposition;
