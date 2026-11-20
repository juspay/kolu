#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
facts="$here/facts.js"
out="$here/../patches/session-list-info.patch"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

version="$(jq -r '.packages["node_modules/@agentclientprotocol/claude-agent-acp"].version' "$here/../shim/package-lock.json")"
if [[ -z "$version" || "$version" == "null" ]]; then
  echo "no pin found in adapter/shim/package-lock.json" >&2
  exit 1
fi
curl -sfSL "https://registry.npmjs.org/@agentclientprotocol/claude-agent-acp/-/claude-agent-acp-$version.tgz" -o "$work/pkg.tgz"
mkdir "$work/pkg"
tar -xzf "$work/pkg.tgz" -C "$work/pkg" package/dist/acp-agent.js
bundle="$work/pkg/package/dist/acp-agent.js"
echo "source bundle: pristine claude-agent-acp $version"

cp "$bundle" "$work/original.js"

{
  cat <<'BUNDLEHEAD'
/**
 * olai patch (session-list-info) — GENERATED from adapter/session-list-info/facts.js
 * by `bash packages/acp-claude/adapter/session-list-info/regenerate.sh`. The pairing and the scanning
 * rules are TESTED there; edit THAT file, run the script, and the bundle gets
 * the answer the suite asserts. Editing the text below by hand is the drift
 * this tooling exists to remove.
 */

const sessionListFactsCache = new Map();

// The amortizing state sayTimestampLossOnce asks the caller to hold: one
// line per process, and this is what remembers having said it.
const timestampLossOnce = { told: false };

BUNDLEHEAD
  sed -E -e 's/^export //' "$facts"
} > "$work/helpers.js"

cat > "$work/listSessions.js" <<'BODY'
    async listSessions(params) {
        const dir = params.cwd ?? undefined;
        const sdk_sessions = await listSessions({ dir });
        // olai patch (session-list-info), second half — the protocol's own
        // rows beside the two facts each transcript has ready, and the
        // supersession pairing over the listed set. The helper block above
        // the class is GENERATED from adapter/session-list-info/facts.js; run
        // `bash packages/acp-claude/adapter/session-list-info/regenerate.sh` after editing THAT — the
        // rulebook and its tests live in one place.
        const rows = [];
        for (const session of sdk_sessions) {
            if (!session.cwd)
                continue;
            rows.push({
                entry: {
                    sessionId: session.sessionId,
                    cwd: session.cwd,
                    title: sanitizeTitle(session.summary),
                    updatedAt: new Date(session.lastModified).toISOString(),
                },
                lastModified: session.lastModified,
                facts: await sessionListFactsOf({
                    sessionId: session.sessionId,
                    fileSize: session.fileSize,
                    lastModified: session.lastModified,
                    dir,
                }, {
                    cache: sessionListFactsCache,
                    messages: getSessionMessages,
                    info: getSessionInfo,
                    say: (line) => this.logger.error(line),
                }),
            });
        }
        // The pairing's candidates may not be headless or daemon sessions: a
        // scripted same-directory driver can be the recorded talk just before
        // a clear was, and the line a person is about to click may name the
        // conversation a human was in, not the spawning tool's. It is one
        // more walk of the same project dir, asked for only when at least
        // one listed transcript OPENED BY /clear — the uncommon case it is
        // for. NOTE: listSessions's own answer needs neither walk.
        let detectable = null;
        if (rows.some((row) => row.facts?.clearedAt !== undefined)) {
            detectable = new Set((await listSessions({ dir, includeProgrammatic: false })).map((info) => info.sessionId));
        }
        const links = pairSupersessions(rows.map((row) => ({
            id: row.entry.sessionId,
            cwd: row.entry.cwd,
            lastModified: row.lastModified,
            clearedAt: row.facts?.clearedAt,
        })), {
            includeId: (id) => detectable === null || detectable.has(id),
            say: (line) => this.logger.error(line),
        });
        // The notes promise ONE logger line the day `SessionMessage`'s
        // timestamp passthrough goes away, and links quietly dying is the
        // signpost's scenario: facts carry the shape, the row list is right
        // here, the amortizing state next to the cache holds having said it.
        sayTimestampLossOnce(rows.map((row) => row.facts), timestampLossOnce, (line) => this.logger.error(line));
        return {
            sessions: rows.map(({ entry, facts }) => facts === undefined
                ? entry
                : {
                    ...entry,
                    _meta: {
                        claudeCode: {
                            messageCount: facts.messageCount,
                            ...(links.has(entry.sessionId) ? { supersededBy: links.get(entry.sessionId) } : {}),
                        },
                    },
                }),
        };
    }
BODY

awk -v helpers="$work/helpers.js" -v listbody="$work/listSessions.js" '
  BEGIN {
    while ((getline l < helpers) > 0) helper_block = helper_block l ORS
    while ((getline l < listbody) > 0) list_block = list_block l "\n"
    in_list = 0
  }
  /^import \{ deleteSession, getSessionMessages, listSessions, query, \} from "@anthropic-ai\/claude-agent-sdk";$/ {
    print "import { deleteSession, getSessionInfo, getSessionMessages, listSessions, query, } from \"@anthropic-ai/claude-agent-sdk\";"
    next
  }
   /^export class ClaudeAcpAgent {/{
    printf "%s", helper_block
  }
  /^    async listSessions\(params\) \{$/ {
    in_list = 1
    printf "%s", list_block
    next
  }
  in_list == 1 && /^    \}$/ { in_list = 0; next }
  in_list == 1 { next }
  { print }
' "$work/original.js" > "$work/rebuilt.js"

for marker in sessionListFactsOf 'const sessionListFactsCache' pairSupersessions sayTimestampLossOnce getSessionInfo; do
  if [[ "$(grep -c "$marker" "$work/rebuilt.js" || true)" -lt 1 ]]; then
    echo "anchor missed: '$marker' is not in the rebuild — the anchor moved; fix the script's anchors." >&2
    exit 1
  fi
done

diff -u --label a/dist/acp-agent.js --label b/dist/acp-agent.js \
  "$work/original.js" "$work/rebuilt.js" > "$work/raw.patch" || test $? -eq 1

mv "$work/raw.patch" "$out"
mkdir -p "$work/check/dist" && cp "$work/original.js" "$work/check/dist/acp-agent.js"
(cd "$work/check" && patch -p1 -F0 --dry-run -d . < "$out" >/dev/null)
echo "$out regenerated (anchored splice, diff-computed hunks; $(grep -c '^+' "$out") additions)"
