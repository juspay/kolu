use serde::{Deserialize, Serialize};

pub fn hello() -> &'static str {
  "kolu"
}

/// Default terminal dimensions used as initial size and fallback.
pub const DEFAULT_COLS: u16 = 80;
pub const DEFAULT_ROWS: u16 = 24;

// ── Terminal Types ──

pub type TerminalId = String;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum TerminalStatus {
  /// PTY alive, recent output (< 5s).
  Running,
  /// PTY alive, no recent output.
  Idle,
  /// PTY exited with code.
  Exited(i32),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Terminal {
  pub id: TerminalId,
  pub label: String,
  pub command: Vec<String>,
  pub status: TerminalStatus,
}

// ── API Types ──

#[derive(Debug, Deserialize)]
pub struct CreateTerminalRequest {
  pub label: String,
  #[serde(default = "default_command")]
  pub command: Vec<String>,
}

fn default_command() -> Vec<String> {
  vec![std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())]
}

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
