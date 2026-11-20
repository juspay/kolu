import type { Leg, Meta } from "@kolu/acp/engine";

export interface Said {
  readonly mcp?: ReturnType<Leg["mcpCall"]>;
  readonly name?: string;
  readonly parent?: string;
}

const NOTHING: Said = Object.freeze({});

const saidIn = (leg: Leg, meta: Meta, frame?: unknown): Said => {
  const name = leg.toolNameIn(meta, frame);
  const parent = leg.parentToolUse(meta);
  if (name === null && parent === null) return NOTHING;
  return {
    ...(name === null ? {} : { name }),
    ...(parent === null ? {} : { parent }),
  };
};

export class Calls {
  #said = new Map<string, Said>();
  readonly #leg: Leg;

  constructor(leg: Leg) {
    this.#leg = leg;
  }

  heard(id: string, meta: Meta, frame?: unknown, session?: string): void {
    const said = saidIn(this.#leg, meta, frame);
    if (said === NOTHING) return;
    const key = this.#key(id, session);
    this.#said.set(key, { ...this.#said.get(key), ...said });
  }

  recognized(
    id: string,
    mcp: ReturnType<Leg["mcpCall"]>,
    session?: string,
  ): void {
    if (mcp.length === 0) return;
    const key = this.#key(id, session);
    this.#said.set(key, { ...this.#said.get(key), mcp });
  }

  about(id: string | null, session?: string): Said {
    if (id === null) return NOTHING;
    const said = this.#said.get(this.#key(id, session));
    if (said?.name !== undefined) return said;
    const named = this.#leg.toolNameOf(id);
    if (named === null) return said ?? NOTHING;
    return said === undefined ? { name: named } : { ...said, name: named };
  }

  #key(id: string, session?: string): string {
    return this.#leg.nativeActivity && session !== undefined
      ? JSON.stringify([session, id])
      : id;
  }

  forget(): void {
    this.#said.clear();
  }
}
