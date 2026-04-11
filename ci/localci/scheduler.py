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
    module = sys.argv[1]
    try:
        recipes = data["modules"][module]["recipes"]
    except KeyError:
        print(f"scheduler: module {module!r} not found in just dump", file=sys.stderr)
        return 1

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
        sys_tags = [g.split(":", 1)[1] for g in groups if g.startswith("system:")]
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
