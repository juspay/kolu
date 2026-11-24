// @vitest-environment happy-dom
import { decodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

const seam = vi.hoisted(() => ({
  sent: [] as { via: string; host: unknown; input: unknown }[],
  asked: [] as string[],
  allowed: true,
}));

vi.mock("./wire", async () => {
  const { Effect } = await import("effect");
  return {
    activePadiRpc: {
      lifecycle: {
        sendInput: (input: unknown) => {
          seam.sent.push({ via: "active", host: null, input });
          return Effect.void;
        },
      },
    },
    padiRpcOf: (host: unknown) => ({
      lifecycle: {
        sendInput: (input: unknown) => {
          seam.sent.push({ via: "padiRpcOf", host, input });
          return Effect.void;
        },
      },
    }),
  };
});

vi.mock("./conductor/personInput", () => ({
  personInput: (id: string) => {
    seam.asked.push(id);
    return seam.allowed;
  },
  personInputAt: (ref: string) => {
    seam.asked.push(ref);
    return seam.allowed;
  },
}));

vi.mock("./terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({ focusedId: () => null }),
}));

vi.mock("./useMobile", () => ({ isTouch: () => true }));

import MobileKeyBar from "./MobileKeyBar";

const disposers: Array<() => void> = [];

const mount = (target?: { host: string; id: TerminalId }) => {
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(() => <MobileKeyBar target={target} />, root);
  disposers.push(() => {
    dispose();
    root.remove();
  });
};

const pressSlash = () => {
  document
    .querySelector('[data-testid="mobile-key-slash"]')
    ?.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
};

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  seam.sent = [];
  seam.asked = [];
  seam.allowed = true;
});

describe("MobileKeyBar", () => {
  it("sends a key to the terminal it was told about, on that host", async () => {
    mount({ host: "remote:nix@example", id: ID });
    pressSlash();
    await vi.waitFor(() => expect(seam.sent).toHaveLength(1));
    expect(seam.sent[0]?.via).toBe("padiRpcOf");
    expect(seam.sent[0]?.host).toEqual(decodeHostKey("remote:nix@example"));
    expect(seam.sent[0]?.input).toEqual({ id: ID, data: "/" });
    expect(seam.asked).toContain(`remote:nix@example/${ID}`);
  });

  it("sends nothing when the gate refuses", () => {
    seam.allowed = false;
    mount({ host: "remote:nix@example", id: ID });
    pressSlash();
    expect(seam.sent).toHaveLength(0);
  });

  it("sends nothing with no target and no focused terminal", () => {
    mount();
    pressSlash();
    expect(seam.sent).toHaveLength(0);
    expect(seam.asked).toHaveLength(0);
  });
});
