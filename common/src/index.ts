// WebSocket protocol messages (JSON, sent as text frames)
// Binary frames carry raw PTY I/O directly.

export type WsClientMessage = {
  type: "Resize";
  cols: number;
  rows: number;
};

export type WsServerMessage = {
  type: "Exit";
  exit_code: number;
};

export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
export const SCROLLBACK_LIMIT = 100 * 1024; // 100KB

export function hello(): string {
  return "kolu";
}
