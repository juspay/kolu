#!/usr/bin/env bash
# Render a workflow YAML as a mermaid flowchart and optionally
# update the mermaid block in .claude/padi/README.md.
#
# Usage: nix run ./padi#render-mermaid -- do.yaml
#        nix run ./padi#render-mermaid -- do.yaml --update

set -euo pipefail

PADI_DIR="$(git rev-parse --show-toplevel)/.claude/padi"
FILE="${PADI_DIR}/${1:?Usage: render-mermaid <workflow.yaml> [--update]}"
UPDATE="${2:-}"

# Convert YAML to JSON once, then jq does all the work
JSON=$(yq -o=json '.' "$FILE")
DEFAULT_MAX=$(echo "$JSON" | jq '.defaults.max_visits // 1')

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# --- generate mermaid ---
{
echo "flowchart TD"

# Node definitions
echo "$JSON" | jq -r --argjson dm "$DEFAULT_MAX" '
  .nodes | to_entries[] |
  .key as $id | .value as $n |
  ($n.max_visits // $dm) as $max |
  (if $n.skill then "skill" elif $n.run then "run" else "prompt" end) as $type |
  ($n.description // $id) as $desc |
  "  " + $id + "[\"" + $id + "\\n─────\\n" + $desc +
    (if $max > 1 then "\\n⟲ max " + ($max|tostring) else "" end) +
  "\"]"'

echo ""

# Edges
echo "$JSON" | jq -r '
  .nodes | to_entries[] |
  .key as $from |
  select(.value.on) |
  .value.on | to_entries[] |
  if .key == "default" then
    "  " + $from + " --> " + .value
  else
    "  " + $from + " -->|\"" + .key + "\"| " + .value
  end'

echo ""

# Style classes
echo "  classDef skill fill:#6366f1,stroke:#4f46e5,color:#fff"
echo "  classDef run fill:#0d9488,stroke:#0f766e,color:#fff"
echo "  classDef prompt fill:#64748b,stroke:#475569,color:#fff"

for TYPE in skill run prompt; do
  IDS=$(echo "$JSON" | jq -r --arg t "$TYPE" '
    [.nodes | to_entries[] |
     (if .value.skill then "skill" elif .value.run then "run" else "prompt" end) as $nt |
     select($nt == $t) | .key] | join(",")')
  [ -n "$IDS" ] && echo "  class $IDS $TYPE"
done

} > "$TMPFILE"

if [ "$UPDATE" = "--update" ]; then
  README="${PADI_DIR}/README.md"
  awk '
    /^```mermaid/ && !done { skip=1; print; next }
    /^```/ && skip { skip=0; system("cat '"$TMPFILE"'"); print; done=1; next }
    !skip { print }
  ' "$README" > "${README}.tmp"
  mv "${README}.tmp" "$README"
  echo "Updated ${README}"
else
  cat "$TMPFILE"
fi
