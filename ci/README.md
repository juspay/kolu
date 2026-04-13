# ci/ — local CI recipes

All CI justfile targets live in this directory. They encapsulate each CI step as a bare `just` recipe, making it easy for both agents and developers to run them locally — mirroring exactly what remote CI (GitHub Actions) runs.

## Usage

```sh
just ci              # run all steps in parallel (current system)
just ci::typecheck   # single step
just ci::e2e         # single step (depends on nix)
```

## Relationship to GitHub Actions

`.github/workflows/ci.yaml` defines the job DAG — which steps run on which system, and their dependencies. Each GHA job calls a recipe from this directory (e.g. `just ci::nix`, `just ci::e2e`). Running `just ci` locally is equivalent to running all GHA jobs on the current machine.
