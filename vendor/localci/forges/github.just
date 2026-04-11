# localci GitHub forge backend.
#
# Provides (at top-level): repo, _signoff, _list-statuses, protect
# Status context prefix: "ci/<step>"
#
# Imported flat into the consumer's top-level justfile so the library (which
# is mounted as `mod localci`) can invoke `_signoff` and `_list-statuses` via
# unqualified `just _name` (top-level dispatch from inside the module).

repo := `git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'`

# Git HEAD sha for the commit under test. Defined here in addition to
# lib.just because forge recipes live at top-level (for library→forge
# bare dispatch) while lib.just is inside the `localci::` module, and
# just module variables aren't visible from top-level.
sha := `git rev-parse HEAD`

# Prefix for GitHub status context names. Kept as a variable so consumers
# can override if "ci/" collides with something else in their forge.
context_prefix := "ci/"

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
    contexts=$(just localci::_contexts)
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
