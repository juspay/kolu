use serde::{Deserialize, Serialize};

pub fn hello() -> &'static str {
  "kolu"
}

/// Default terminal dimensions used as initial size and fallback.
pub const DEFAULT_COLS: u16 = 80;
pub const DEFAULT_ROWS: u16 = 24;

/// Messages sent from the browser client to the server over WebSocket.
/// Binary frames carry raw terminal input (keystrokes).
/// Text frames carry JSON-encoded control messages like resize.
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsClientMessage {
  /// Client's terminal viewport changed size (e.g. browser window resize).
  /// Server forwards this to the PTY so programs reflow correctly.
  Resize { cols: u16, rows: u16 },
}

/// Messages sent from the server to the browser client over WebSocket.
/// Binary frames carry raw PTY output (terminal escape sequences + text).
/// Text frames carry JSON-encoded lifecycle events.
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsServerMessage {
  /// The PTY process has exited. Terminal is now read-only.
  Exit { exit_code: i32 },
}
