/**
 * The inference `acp/patches/session-list-info.patch` runs inside the pinned
 * claude-agent-acp adapter, split out so its edges are TESTED by its own suite and
 * not its comments. The patch's module-level helper block is this file's
 * content with the `export` keywords off (`regenerate.sh` splices it); the
 * patch's `listSessions` body is the caller and stays hand-written there,
 * against these three functions.
 *
 * DEPENDENCY-FREE by construction: this text has to survive verbatim in the
 * adapter's compiled bundle, so anything it needs — the SDK's readers, a log,
 * a cache map — is a parameter.
 *
 * The questions it answers:
 *
 *  - `sessionListFactsOf(session, deps)` — WHAT ONE LISTED SESSION's
 *    transcript says: the conversation's message count, when it OPENED BY
 *    `/clear` (and whether a missing `timestamp` hid that fact), honestly:
 *    `undefined` — the list's losing direction — for a transcript that could
 *    not be READ, and only a real read's results reach the cache.
 *  - `clearOpenedAtOf(messages)` — the `/clear` opening, out of the opening
 *    stretch alone: the harness records the command as the new session's
 *    first conversation entries (verified against the vendored CLI,
 *    2026-08-28), so nothing past it can mean "the opening".
 *  - `pairSupersessions(rows, opts)` — which OLDER row each `/clear` opening
 *    replaced, over the listed set alone. It refuses two candidates tied at
 *    one moment, a second claimant for one predecessor, a candidate too
 *    long gone, and a session the listing's own rules wouldn't name — and it
 *    SAYS every refusal through `say`.
 */

// ── reading the opening ──────────────────────────────────────────────

/** How deep into a transcript the `/clear` OPENING can still be the opening:
 *  the local-command marker and the harness's trust/onboarding entries
 *  precede it; ten past them, a `/clear` found there is a REOPENING after one rather than
 *  an opening by one — not a fact the pairing carries. */
const OPENING_STRETCH = 10

/** The command marker the harness wraps local commands in. */
const COMMAND_MARKER = /<command-name>\s*(\S+)\s*<\/command-name>/

/**
 * The text of one SDK message as a person would read it. User content is a
 * bare string or a list of typed blocks; only text blocks carry command
 * markers.
 */
export const sdkMessageText = (message) => {
    const content = message?.message?.content
    if (typeof content === "string") {
        return content
    }
    if (Array.isArray(content)) {
        return content
            .filter((block) => block?.type === "text")
            .map((block) => String(block.text ?? ""))
            .join("\n")
    }
    return ""
}

/**
 * WHETHER this transcript opens by clearing an older conversation, and if so
 * WHEN: the timestamp of the `/clear` command, in epoch ms.
 *
 * The three `at: undefined` ways out are NOT one event:
 *   - not-a-clear: this transcript simply began another way (no marker in
 *     the stretch, or an opening word of somebody's own);
 *   - no-timestamp: the marker was found, UNDATED — which is SHOULD 3's
 *     silent way out: `timestamp` is an undocumented passthrough of the
 *     SDK's `SessionMessage`, and `sawClear` is what lets the caller log
 *     ONE line per process for it instead of the pair just dying quiet;
 *   - not-an-opening: a `/clear` found past the stretch is a REOPEN of a
     session that began normally, and opening it as a clear would put a
     link on the wrong conversation entirely.
 */
export const clearOpenedAtOf = (messages) => {
    for (const message of messages.slice(0, OPENING_STRETCH)) {
        const command = sdkMessageText(message).match(COMMAND_MARKER)
        if (command === null) {
            // Not a command entry: the opening stretch is over.
            if (sdkMessageText(message) !== "") {
                return { sawClear: false, at: undefined }
            }
            continue
        }
        if (command[1] === "/clear") {
            const at = Date.parse(message.timestamp ?? "")
            return { sawClear: true, at: Number.isNaN(at) ? undefined : at }
        }
    }
    return { sawClear: false, at: undefined }
}

// ── what one listed session says ─────────────────────────────────────

/**
 * Read the two transcript facts for ONE listed session.
 *
 * `session` — the SDK's row: `{ sessionId, fileSize?, lastModified, dir? }`.
 * `deps`:
 *   - `messages(id, { dir })` — like the SDK's `getSessionMessages`;
 *   - `info(id, { dir })` — like the SDK's `getSessionInfo`, the DESCRIBE
 *     oracle for the messages call's empty answer: its own contract is
 *     `undefined` both for a session whose file cannot be located or opened
 *     (`Yo` is the messages call's own locator — a failure the reviewer
 *     walked in through is a failure here too) AND for less-severe losses
 *     like a sidechain or a summaryless row — a transcript there CAN be
 *     read but the SDK declines to describe it. Either way NO stamp, because
 *     "we could not say" and "the harness keeps nothing to repeat" price
 *     out the same on a row a person is about to click; and the same
 *     sources make `getSessionMessages` answer `[]` for "not readable" as
 *     for "never anyone spoke" — which is why the count cannot be read off
 *     `[]` alone;
 *   - `say(line)` — the operator's channel rather than the row's;
 *   - `cache` — a `Map`; keyed by session id with the row's own
 *     `(fileSize, lastModified)` carried beside the facts, so a transcript
 *     that MOVED since is reread and one that did not is not. Only READS that
 *     produced facts are cached: a transient failure must be allowed to mend
 *     on the next list rather than be remembered for the process's life.
 *
 * Answers `{ messageCount, clearedAt?, timestampLoss }`, or `undefined`: a
 * row nobody read a word of carries NO stamps, not a zero.
 */
export const sessionListFactsOf = async (session, deps) => {
    const id = session.sessionId
    const had = deps.cache.get(id)
    if (had !== undefined && had.fileSize === session.fileSize && had.lastModified === session.lastModified) {
        return had.facts
    }
    try {
        const messages = await deps.messages(id, { dir: session.dir })
        if (messages.length === 0 && await deps.info(id, { dir: session.dir }) === undefined) {
            deps.say(`session/list: ${id}: no readable transcript; the row is listed unstamped`)
            return undefined
        }
        const opened = clearOpenedAtOf(messages)
        const facts = {
            messageCount: messages.length,
            timestampLoss: opened.sawClear && opened.at === undefined,
        }
        if (opened.at !== undefined) {
            facts.clearedAt = opened.at
        }
        if (deps.cache.size >= CACHE_CAP) {
            // Oldest out first: Map preserves insertion order. A bound the
            // review asked for after finding the Map had none.
            deps.cache.delete(deps.cache.keys().next().value)
        }
        deps.cache.set(id, { fileSize: session.fileSize, lastModified: session.lastModified, facts })
        return facts
    }
    catch (error) {
        deps.say(`session/list: ${id}: transcript read failed: ${error}`)
        return undefined
    }
}

/** The cache's ceiling. The map lives in the adapter process; a per-directory
 *  store with a few thousand sessions should not grow it without end, and
 *  evicting the OLDEST is the entire policy worth having: recency of listing
 *  is recency of being asked about. */
const CACHE_CAP = 2000

// ── pairing a clear with the conversation it ended ──────────────────

/**
 * How far back the predecessor may reach. A `/clear` ends the conversation
 * the reader was JUST in: a candidate touched more than one week before the
 * command is a sibling with no reason given for naming it, and naming an
 * arbitrarily old one is exactly the confidence-without-cause the first
 * version got right in the notes and wrong in the code (opus review, MUST 2).
 * Seven days, not shorter: the session it ended need only have been open,
 * not recently active — a week is the prompt-window a return read can span.
 */
const RECENT_WITHIN_MS = 7 * 24 * 60 * 60 * 1000

/**
 * :: rows: Array<{ id, cwd, lastModified, clearedAt? }> — every listed row,
 *    in ANY ORDER (the answer must not depend on the listing's sorting of
 *    it: the old loop's answer did, when two openers claimed one row).
 * :: opts:
 *      includeId(id)   — whether the row is PAIRABLE: the patch passes the
 *                        non-programmatic listing's filter so headless and
 *                        daemon sessions can list without being named a
 *                        predecessor. Defaults to all.
 *      recentWithinMs  — see above.
 *      say(line)       — one report per refusal and per undated opener:
 *                        the row's silence should be heard somewhere.
 * <<- Map of predecessor id -> successor id. A row that is no one's
 *     predecessor appears nowhere: the response carries no field then, which
 *     is the protocol shape of "nothing was said".
 *
 * The rules, each its opposite of a way the first version lied:
 *
 *   - a candidate touched AT the command's time is admissible (mtime and
 *     stamps share a domain; excluding it walked past a same-timestamp
 *     predecessor — grok's boundary); a candidate touched past it is not;
 *   - two candidates TIED at the maximum are no answer;
 *   - a row two openers claim is no answer for EITHER — the second claimant
 *     must not overwrite, and unlike the old code the first one does not win
 *   - nothing written more than RECENT_WITHIN_MS before the command is the
 *     predecessor; where it would have come from is we have no idea, NOT a
 *     guess at whatever was touched last before it.
 *
 * The residual the rules do NOT defend: an opener that makes NO claim —
 * unreadable or undated — does not protect its predecessor: a later opener
 * can still link that predecessor alone, and that is the same shape of
 * wrong-lie one step rarer, which we say in the notes as the walk's limit
 * rather than cheat with a guard that walks past it.
 */
export const pairSupersessions = (rows, opts = {}) => {
    const include = opts.includeId ?? (() => true)
    const bound = opts.recentWithinMs ?? RECENT_WITHIN_MS
    const say = opts.say ?? (() => {})
    const claims = []
    for (const row of rows) {
        if (row.clearedAt === undefined) {
            continue
        }
        const candidates = rows.filter((other) => other.id !== row.id &&
            other.cwd === row.cwd &&
            include(other.id) &&
            other.lastModified <= row.clearedAt &&
            other.lastModified >= row.clearedAt - bound)
        if (candidates.length === 0) {
            say(`session/list: ${row.id} opened from a /clear, but no listed predecessor fits; no link`)
            continue
        }
        const newest = Math.max(...candidates.map((c) => c.lastModified))
        const atMax = candidates.filter((c) => c.lastModified === newest)
        if (atMax.length !== 1) {
            say(`session/list: ${row.id}: ${atMax.length} candidates tied at ${new Date(newest).toISOString()}; no link`)
            continue
        }
        claims.push({ predecessor: atMax[0].id, successor: row.id })
    }
    // SECOND CLAIMANT IS A REFUSAL FOR BOTH — the first-come overwrite was
    // the failure direction the review's scenario walked in through, and an
    // order-independent map is the only shape whose answer this cannot be.
    const byPredecessor = new Map()
    for (const claim of claims) {
        const got = byPredecessor.get(claim.predecessor) ?? []
        got.push(claim.successor)
        byPredecessor.set(claim.predecessor, got)
    }
    const links = new Map()
    for (const [predecessor, successors] of byPredecessor) {
        if (successors.length > 1) {
            say(`session/list: ${predecessor} is claimed by ${successors.join(" and ")}; neither may take the link`)
            continue
        }
        links.set(predecessor, successors[0])
    }
    return links
}

// ── the once-per-process announcement of an SDK build going quiet ─────

/**
 * Say it ONCE, the way the notes promise: the timestamp passthrough is
 * undocumented and the bump-day its own loss — facts carry the shape
 * (`timestampLoss`), the CALLER possesses the row list at one slice of
 * time, and this emits ONE sentence on the logger for the first call that
 * actually has a lost case, never on rows that carry the borrowed words of
 * health.
 *
 * - `factsList` — row facts or `undefined` values, the caller's own
 *   shape (passthroughs don't filter: an unreadable transcript is not here,
 *   exactly as the row is).
 * - `state` — a shared `{ told: boolean }` the caller owns; the ONLY
 *   amortization this has, and the caller's own to hold.
 * - `say` — the operator's channel; emit the line
 *
 * Returns true when THIS call spoke (mostly for the test).
 */
export const sayTimestampLossOnce = (factsList, state, say) => {
    if (state.told || !factsList.some((facts) => facts?.timestampLoss === true)) {
        return false
    }
    state.told = true
    say("session/list: a transcript opened by /clear has no timestamp " +
        "— SessionMessage's timestamp passthrough may be gone; " +
        "no supersession links can be made on this build")
    return true
}
