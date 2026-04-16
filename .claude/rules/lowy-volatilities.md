---
paths:
  - "packages/client/src/**"
---

## Areas of Volatility

Surviving candidates from Kolu's own variable-vs-volatile screen. Each row names a volatility that has already shifted in this codebase and has a concrete encapsulation target. Rows are not findings — `/lowy` re-applies Lowy's bar (what + why + risk × likelihood × effect) and audits whether the boundaries under review actually encapsulate these, rather than leaking them into consumers.

| Area of volatility          | What changes                                                                                                    | Why volatile (likelihood × effect)                                                                                                                                                        | Expected encapsulation                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server-pushed state delivery | Transport and shape of live server state — oRPC async iterables today, with prior iterations and likely future ones (SSE, WebSocket, RSC-style server signals) | Likelihood: the transport for live state has already moved in this codebase; streaming is a live concern (see `streaming.instructions.md`). Effect: every consumer of live server state would need rewriting if the transport leaked into components — blast radius is the entire reactive surface of the client. | Behind the `createSubscription` seam (`packages/client/src/rpc/createSubscription.ts`). Consumers see a SolidJS-signal-shaped API with `reconcile` fine-grained reactivity and never reach for the underlying `AsyncIterable`, subscription handle, or reconnection logic directly. One-shot RPC calls go through plain `client.*` calls — they are a *different* volatility and stay out of this seam. |
