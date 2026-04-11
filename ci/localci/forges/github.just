# localci GitHub forge backend.
#
# Provides: repo, _signoff, _list-statuses, protect
# Status context prefix: "<module_name>/<step>"

repo := `git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'`

# Post a GitHub commit status for this step.
_signoff context status description="":
    gh api "repos/{{ repo }}/statuses/{{ sha }}" \
      -f state="{{ status }}" -f context="{{ module_name }}/{{ context }}" \
      -f description="{{ description }}" --silent

# Return normalized JSON map {context: state} for this sha, stripping the
# module_name prefix so lib.just can match against _contexts output.
_list-statuses:
    #!/usr/bin/env bash
    set -euo pipefail
    prefix="{{ module_name }}/"
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
    contexts=$(just {{ module_name }}::_contexts)
    prefix="{{ module_name }}/"
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
