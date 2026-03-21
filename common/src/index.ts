// WebSocket protocol messages (JSON, sent as text frames).
// Binary frames carry raw PTY I/O directly.

export type WsClientMessage = { type: "Resize"; cols: number; rows: number };

export type WsServerMessage = { type: "Exit"; exit_code: number };
