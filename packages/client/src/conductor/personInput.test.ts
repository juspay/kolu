import type { TerminalId } from "kolu-common/surface";
import { afterEach, describe, expect, it, vi } from "vitest";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;
const REMOTE = "remote:nix@example";
const REMOTE_REF = `${REMOTE}/${ID}`;
const LOCAL_REF = `local/${ID}`;

const seam = vi.hoisted(() => ({ membership: new Map<string, unknown>() }));

vi.mock("./useWorks", () => ({ useMembership: () => () => seam.membership }));
vi.mock("../wire", () => ({ encActiveHost: () => "local" }));

import {
  dismissLockCard,
  inputAllowedAt,
  lockCardShown,
  personInput,
  personInputAt,
} from "./personInput";

const member = (driver: "conductor" | "you" | "nobody") => ({
  work: "w",
  title: "w",
  role: "planner",
  driver,
});

afterEach(() => {
  dismissLockCard();
  seam.membership.clear();
});

describe("personInputAt", () => {
  it("refuses and raises the card while the Conductor drives a terminal on another host", () => {
    seam.membership.set(REMOTE_REF, member("conductor"));
    expect(personInputAt(REMOTE_REF)).toBe(false);
    expect(lockCardShown(REMOTE_REF)).toBe(true);
  });

  it("allows input to a terminal you have taken over", () => {
    seam.membership.set(REMOTE_REF, member("you"));
    expect(personInputAt(REMOTE_REF)).toBe(true);
    expect(lockCardShown(REMOTE_REF)).toBe(false);
  });

  it("allows input to a terminal in no work", () => {
    expect(personInputAt(REMOTE_REF)).toBe(true);
  });
});

describe("personInput", () => {
  it("still gates a terminal on the active host by its id", () => {
    seam.membership.set(LOCAL_REF, member("conductor"));
    expect(personInput(ID)).toBe(false);
    expect(lockCardShown(LOCAL_REF)).toBe(true);
  });
});

describe("inputAllowedAt", () => {
  it("answers without raising the card", () => {
    seam.membership.set(REMOTE_REF, member("conductor"));
    expect(inputAllowedAt(REMOTE_REF)).toBe(false);
    expect(lockCardShown(REMOTE_REF)).toBe(false);
  });
});
