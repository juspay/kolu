#!/usr/bin/env python3
"""Read `just --dump --dump-format json` from stdin, emit an execution plan.

For each recipe in the given module, look at its `[group("system:...")]`
attributes to decide which lanes it belongs to. Within each lane, topologically
sort the recipes by just's native dependency graph.

Output (stdout): one line per lane, in the form
    <system>:<step1> <step2> <step3>

Lanes are sorted lexicographically so the scheduler output is stable.
"""

import json
import sys
from collections import defaultdict


def main() -> int:
    data = json.load(sys.stdin)
    # argv[1] is the module name, or "" for top-level (library imported
    # directly into the justfile rather than mounted as a submodule).
    module = sys.argv[1] if len(sys.argv) > 1 else ""
    if module:
        try:
            recipes = data["modules"][module]["recipes"]
        except KeyError:
            print(f"scheduler: module {module!r} not found in just dump", file=sys.stderr)
            return 1
    else:
        recipes = data["recipes"]

    # systems[system_name] = {recipe_name: [dep_recipe_name, ...]}
    systems: "defaultdict[str, dict[str, list[str]]]" = defaultdict(dict)

    for name, r in recipes.items():
        # Skip library-internal recipes (underscore-prefixed).
        if name.startswith("_"):
            continue
        groups = [
            a["group"]
            for a in r.get("attributes", [])
            if isinstance(a, dict) and "group" in a
        ]
        # Tags look like `localci:system:<name>`, e.g. `localci:system:local`
        # or `localci:system:x86_64-linux`. The `localci:` prefix makes it
        # obvious the tag is owned by this library and avoids collisions with
        # other tooling that might use [group("...")] for unrelated reasons.
        sys_tags = [
            g.split(":", 2)[2]
            for g in groups
            if g.startswith("localci:system:")
        ]
        if not sys_tags:
            # A recipe with no system tag is invisible to the scheduler.
            continue
        deps = [d["recipe"] for d in r.get("dependencies", [])]
        for sys_name in sys_tags:
            systems[sys_name][name] = deps

    def topo(edges):
        visited, order = set(), []

        def visit(n):
            if n in visited or n not in edges:
                return
            visited.add(n)
            for d in edges[n]:
                visit(d)
            order.append(n)

        for n in edges:
            visit(n)
        return order

    for sys_name in sorted(systems):
        ordered = topo(systems[sys_name])
        print(f"{sys_name}:{' '.join(ordered)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
