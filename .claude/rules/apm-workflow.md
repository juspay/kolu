---
paths:
  - "agents/**,apm.lock.yaml"
---

## APM Workflow

APM is not a global CLI — it runs via `uvx` through justfile recipes in `agents/ai.just`. Never try to run `apm` directly; always use the just recipes:

- **Install/regenerate** `.claude/` from sources: `just ai::apm`
- **Update a dependency** to its latest ref: `just ai::apm-update <package>` (e.g. `just ai::apm-update srid/agency`)
- **Verify** `.claude/` matches sources (CI-safe, non-destructive): `just ai::apm-sync`
