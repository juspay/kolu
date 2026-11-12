/**
 * `_auth/status_update` — the ACP extension by which an agent says who IT is
 * signed in as, read as data.
 *
 * The notification is CONNECTION-scoped, not session-scoped: it carries no
 * `sessionId`, and the fact it reports belongs to the agent process rather than
 * to any conversation that process holds. That is why the reader takes the
 * params alone and why the chat agent holds the value for the life of the
 * subprocess (`@kolu/acp-harness`'s `agent.ts`).
 *
 * Push only: there is no request method, and no client may ask. An agent
 * advertises that it pushes with an EMPTY marker
 * (`agentCapabilities._meta.authStatus = {}`), and a client that never saw the
 * marker still accepts the notification — the marker says "this agent talks
 * about its identity", never anything about the payload.
 *
 * THE PRODUCER kolu reads is the pinned adapter
 * `@agentclientprotocol/claude-agent-acp` 0.81.2 (the version
 * `packages/integrations/claude-code/acp/shim/package-lock.json` pins and
 * `nix/packages/acp-adapter.nix` builds), whose `dist/auth-status.js` spells
 * the method and whose `dist/acp-agent.js` sends it with
 * `client.extNotification(AUTH_STATUS_UPDATE_METHOD, { authStatus })` and sets
 * the marker from `authStatusCapability()` in its `initialize` reply. It reads
 * its identity at `initialize` (an async `claude auth status --json` probe), on
 * a completed `authenticate` or `logout`, at each session creation (a REFUSED
 * one included), and at the start of each prompt — and pushes only when the
 * payload differs from the last one sent, which is why a reader must hold the
 * value rather than expect one per turn. The extension is interim: the
 * adapter's own note says the fields move out of `_meta` when the upstream RFD
 * lands, so a pin bump is where this reading is re-checked.
 *
 * SILENCE IS NOT LOGGED OUT. An agent that cannot determine its identity sends
 * nothing, and the panel draws nothing; a KNOWN logged-out state is a payload
 * of its own (`kind: "none"`), which is what lets the panel say "not signed
 * in" rather than staying quiet. {@link identityIn} answers `null` only for the
 * former — an absent or unreadable payload — never for the latter.
 *
 * The reading is TOLERANT in one direction on purpose: an unknown `kind` keeps
 * its `label` (and everything else it carried), because the label is a ready UI
 * string and the protocol may grow a sixth kind. `kind: null` is this build's
 * word for "a kind it has no word for"; see {@link AuthStatus}.
 *
 * PURE, and tested as such — the {@link ./usage.ts} pattern, for the same
 * reason: a reading of somebody else's payload is a function over a value, not
 * a branch reachable only by talking a subprocess into sending one.
 */

import type { AuthAccount, AuthStatus } from "./wire.ts";

/** The notification's method name, spelled once for the one subscriber. */
export const AUTH_STATUS_METHOD = "_auth/status_update";

/** The five kinds the protocol names today. A sixth is not an error — it is
 *  just not one this build can label, so it reads as `kind: null`. */
const KINDS = ["account", "api_key", "gateway", "external", "none"] as const;

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/** The account facts an `account` object carries, or `null` when it carries
 *  none of them — which is a payload saying nothing about a person rather than
 *  an account with three empty fields. */
const accountIn = (value: unknown): AuthAccount | null => {
  const email = text(field(value, "email"));
  const organization = text(field(value, "organization"));
  const plan = text(field(value, "plan"));
  return email === null && organization === null && plan === null
    ? null
    : { email, organization, plan };
};

/**
 * The identity a `_auth/status_update` notification states, or `null` for one
 * that states none.
 *
 * The one refusal is a payload with no usable `label`: it is the only field the
 * protocol promises, it is what the panel draws on its own, and an empty string
 * would put a nameless chip in front of a person. Everything else degrades —
 * an unknown `kind`, a missing `detail`, an `account` with no fields.
 */
export const identityIn = (params: unknown): AuthStatus | null => {
  const status = field(params, "authStatus");
  const label = text(field(status, "label"));
  if (label === null) return null;
  const kind = KINDS.find((known) => known === field(status, "kind")) ?? null;
  return {
    kind,
    label,
    detail: text(field(status, "detail")),
    account: accountIn(field(status, "account")),
  };
};
