import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseWorkflowFile } from "./graph.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "padi-test-"));
}

function writeYaml(dir: string, name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe("parseWorkflowFile", () => {
  it("parses a simple workflow without includes", () => {
    const dir = makeTempDir();
    const path = writeYaml(
      dir,
      "simple.yaml",
      `
entry_points:
  default: a
nodes:
  a:
    prompt: "do A"
    on:
      default: b
  b:
    prompt: "do B"
`,
    );

    const graph = parseWorkflowFile(path, "simple");
    assert.equal(Object.keys(graph.nodes).length, 2);
    assert.equal(graph.nodes["a"].edges[0].target, "b");
  });

  it("merges nodes from included files (bare string, no ports)", () => {
    const dir = makeTempDir();
    writeYaml(
      dir,
      "fragment.yaml",
      `
nodes:
  c:
    prompt: "do C"
`,
    );
    const path = writeYaml(
      dir,
      "main.yaml",
      `
include:
  - ./fragment.yaml
entry_points:
  default: a
nodes:
  a:
    prompt: "do A"
    on:
      default: c
`,
    );

    const graph = parseWorkflowFile(path, "main");
    assert.equal(Object.keys(graph.nodes).length, 2);
    assert.ok(graph.nodes["c"]);
  });

  it("applies included file's own defaults to its nodes", () => {
    const dir = makeTempDir();
    writeYaml(
      dir,
      "fragment.yaml",
      `
defaults:
  max_visits: 5
nodes:
  c:
    prompt: "do C"
`,
    );
    const path = writeYaml(
      dir,
      "main.yaml",
      `
include:
  - ./fragment.yaml
defaults:
  max_visits: 1
entry_points:
  default: a
nodes:
  a:
    prompt: "do A"
    on:
      default: c
`,
    );

    const graph = parseWorkflowFile(path, "main");
    assert.equal(graph.nodes["a"].maxVisits, 1);
    assert.equal(graph.nodes["c"].maxVisits, 5);
  });

  it("errors on node name collision", () => {
    const dir = makeTempDir();
    writeYaml(
      dir,
      "fragment.yaml",
      `
nodes:
  a:
    prompt: "conflicting A"
`,
    );
    const path = writeYaml(
      dir,
      "main.yaml",
      `
include:
  - ./fragment.yaml
entry_points:
  default: a
nodes:
  a:
    prompt: "original A"
`,
    );

    assert.throws(() => parseWorkflowFile(path, "main"), /Node name collision/);
  });

  it("errors on circular includes", () => {
    const dir = makeTempDir();
    writeYaml(
      dir,
      "a.yaml",
      `
include:
  - ./b.yaml
nodes:
  x:
    prompt: "X"
`,
    );
    writeYaml(
      dir,
      "b.yaml",
      `
include:
  - ./a.yaml
nodes:
  y:
    prompt: "Y"
`,
    );

    assert.throws(
      () => parseWorkflowFile(join(dir, "a.yaml"), "a"),
      /Circular include/,
    );
  });

  it("errors on dangling edge targets", () => {
    const dir = makeTempDir();
    const path = writeYaml(
      dir,
      "dangling.yaml",
      `
entry_points:
  default: a
nodes:
  a:
    prompt: "do A"
    on:
      default: nonexistent
`,
    );

    assert.throws(() => parseWorkflowFile(path, "dangling"), /Dangling edge/);
  });

  it("supports recursive includes", () => {
    const dir = makeTempDir();
    const sub = join(dir, "sub");
    mkdirSync(sub);
    writeYaml(
      sub,
      "deep.yaml",
      `
nodes:
  d:
    prompt: "deep node"
`,
    );
    writeYaml(
      dir,
      "mid.yaml",
      `
include:
  - ./sub/deep.yaml
nodes:
  c:
    prompt: "mid node"
    on:
      default: d
`,
    );
    const path = writeYaml(
      dir,
      "top.yaml",
      `
include:
  - ./mid.yaml
entry_points:
  default: a
nodes:
  a:
    prompt: "top node"
    on:
      default: c
`,
    );

    const graph = parseWorkflowFile(path, "top");
    assert.equal(Object.keys(graph.nodes).length, 3);
    assert.ok(graph.nodes["d"]);
  });
});

describe("ports", () => {
  it("rewrites :portname to the wired target", () => {
    const dir = makeTempDir();
    writeYaml(
      dir,
      "loop.yaml",
      `
ports:
  done:
nodes:
  step:
    prompt: "do step"
    on:
      default: :done
`,
    );
    const path = writeYaml(
      dir,
      "main.yaml",
      `
include:
  - path: ./loop.yaml
    on:
      done: finish
entry_points:
  default: step
nodes:
  finish:
    prompt: "all done"
`,
    );

    const graph = parseWorkflowFile(path, "main");
    // :done should have been rewritten to "finish"
    assert.equal(graph.nodes["step"].edges[0].target, "finish");
  });

  it("errors on unwired ports", () => {
    const dir = makeTempDir();
    writeYaml(
      dir,
      "loop.yaml",
      `
ports:
  done:
nodes:
  step:
    prompt: "do step"
    on:
      default: :done
`,
    );
    const path = writeYaml(
      dir,
      "main.yaml",
      `
include:
  - path: ./loop.yaml
entry_points:
  default: step
nodes: {}
`,
    );

    assert.throws(() => parseWorkflowFile(path, "main"), /not wired/);
  });

  it("standalone file with ports gets dangling edge error", () => {
    const dir = makeTempDir();
    const path = writeYaml(
      dir,
      "standalone.yaml",
      `
ports:
  done:
entry_points:
  default: step
nodes:
  step:
    prompt: "do step"
    on:
      default: :done
`,
    );

    // Standalone loading doesn't enforce port wiring — unresolved :done
    // becomes a dangling edge instead
    assert.throws(() => parseWorkflowFile(path, "standalone"), /Dangling edge/);
  });

  it("errors when on: references undeclared port", () => {
    const dir = makeTempDir();
    writeYaml(
      dir,
      "loop.yaml",
      `
nodes:
  step:
    prompt: "do step"
`,
    );
    const path = writeYaml(
      dir,
      "main.yaml",
      `
include:
  - path: ./loop.yaml
    on:
      bogus: somewhere
entry_points:
  default: step
nodes:
  somewhere:
    prompt: "target"
`,
    );

    assert.throws(() => parseWorkflowFile(path, "main"), /not declared/);
  });

  it("supports multiple ports wired to different targets", () => {
    const dir = makeTempDir();
    writeYaml(
      dir,
      "branch.yaml",
      `
ports:
  success:
  failure:
nodes:
  check:
    prompt: "check something"
    on:
      passed: :success
      failed: :failure
`,
    );
    const path = writeYaml(
      dir,
      "main.yaml",
      `
include:
  - path: ./branch.yaml
    on:
      success: celebrate
      failure: retry
entry_points:
  default: check
nodes:
  celebrate:
    prompt: "yay"
  retry:
    prompt: "try again"
`,
    );

    const graph = parseWorkflowFile(path, "main");
    const edges = graph.nodes["check"].edges;
    assert.equal(
      edges.find((e) => e.condition === "passed")?.target,
      "celebrate",
    );
    assert.equal(edges.find((e) => e.condition === "failed")?.target, "retry");
  });

  it("works with recursive includes that have ports", () => {
    const dir = makeTempDir();
    writeYaml(
      dir,
      "inner.yaml",
      `
ports:
  out:
nodes:
  inner-step:
    prompt: "inner"
    on:
      default: :out
`,
    );
    writeYaml(
      dir,
      "outer.yaml",
      `
ports:
  done:
include:
  - path: ./inner.yaml
    on:
      out: :done
nodes:
  outer-step:
    prompt: "outer"
    on:
      default: inner-step
`,
    );
    const path = writeYaml(
      dir,
      "root.yaml",
      `
include:
  - path: ./outer.yaml
    on:
      done: finish
entry_points:
  default: outer-step
nodes:
  finish:
    prompt: "end"
`,
    );

    const graph = parseWorkflowFile(path, "root");
    // inner-step's :out → outer's :done → root's "finish"
    assert.equal(graph.nodes["inner-step"].edges[0].target, "finish");
  });
});
