import type { AuthAccount, AuthStatus } from "./wire.ts";

/** The notification's method name, spelled once for the one subscriber. */
export const AUTH_STATUS_METHOD = "_auth/status_update";

const KINDS = ["account", "api_key", "gateway", "external", "none"] as const;

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

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
