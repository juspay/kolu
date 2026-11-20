const OPENING_STRETCH = 10

const COMMAND_MARKER = /<command-name>\s*(\S+)\s*<\/command-name>/

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

export const clearOpenedAtOf = (messages) => {
    for (const message of messages.slice(0, OPENING_STRETCH)) {
        const command = sdkMessageText(message).match(COMMAND_MARKER)
        if (command === null) {
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

/**
 * Read the two transcript facts for ONE listed session.
 *
 * `deps.info` is the arbiter for an empty `deps.messages` answer: the SDK's
 * `getSessionMessages` returns `[]` for a session it cannot read as for one
 * nobody spoke in, so a row nobody read a word of answers `undefined` — no
 * stamps, rather than a zero.
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

const CACHE_CAP = 2000

const RECENT_WITHIN_MS = 7 * 24 * 60 * 60 * 1000

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
