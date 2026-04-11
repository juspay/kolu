# localci GitHub forge backend.
#
# Provides: repo, _signoff, _list-statuses, protect
# Status context prefix: `ci/<step>` (when lib is imported at top-level) or
# `<module_name>/<step>` (when mounted as a submodule).

repo := `git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'`

# Prefix for GitHub status context names. Defaults to "ci/" when the library
# is imported directly into a top-level justfile (module_name is empty), or
# "<module_name>/" when mounted as a submodule.
context_prefix := if module_name == "" { "ci/" } else { module_name + "/" }

# Post a GitHub commit status for this step.
_signoff context status description="":
    gh api "repos/{{ repo }}/statuses/{{ sha }}" \
      -f state="{{ status }}" -f context="{{ context_prefix }}{{ context }}" \
      -f description="{{ description }}" --silent

# Return normalized JSON map {context: state} for this sha, stripping the
# context_prefix so lib.just can match against _contexts output.
_list-statuses:
    #!/usr/bin/env bash
    set -euo pipefail
    prefix="{{ context_prefix }}"
    gh api "repos/{{ repo }}/statuses/{{ sha }}" --jq "
        [.[] | select(.context | startswith(\"$prefix\"))]
        | group_by(.context)
        | map(max_by(.updated_at))
        | map({(.context | sub(\"^$prefix\"; \"\")): .state})
        | add // {}"

# Set up branch protection requiring all CI status checks.
# Contexts are auto-derived from _contexts — no prior CI run needed.
protect branch=`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`:
    #!/usr/bin/env bash
    set -euo pipefail
    contexts=$(just {{ dispatch }}_contexts)
    prefix="{{ context_prefix }}"
    echo "Setting required status checks on {{ branch }}:"
    args=()
    while IFS= read -r ctx; do
        full="${prefix}${ctx}"
        echo "  - $full"
        args+=(-f "required_status_checks[checks][][context]=$full")
    done <<< "$contexts"
    gh api "repos/{{ repo }}/branches/{{ branch }}/protection" -X PUT \
      -F "required_status_checks[strict]=true" \
      "${args[@]}" \
      -F "enforce_admins=false" \
      -F "restrictions=null" \
      -F "required_pull_request_reviews=null" \
      --silent
    echo "Done — {{ branch }} now requires CI to pass."
