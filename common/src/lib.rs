use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub fn hello() -> &'static str {
  "kolu"
}

/// Default terminal dimensions used as initial size and fallback.
pub const DEFAULT_COLS: u16 = 80;
pub const DEFAULT_ROWS: u16 = 24;

// ── Terminal types ──

pub type TerminalId = String;

/// Terminal process status, derived from child process state + output activity.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub enum TerminalStatus {
  Running,
  Idle,
  Exited(i32),
}

/// Predefined terminal commands.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema)]
pub enum TerminalCommand {
  Shell,
  Opencode,
  Claude,
}

impl TerminalCommand {
  pub fn label(&self) -> &'static str {
    match self {
      Self::Shell => "shell",
      Self::Opencode => "opencode",
      Self::Claude => "claude",
    }
  }

  pub fn to_argv(&self, shell: &str) -> Vec<String> {
    match self {
      Self::Shell => vec![shell.to_string()],
      Self::Opencode => vec!["opencode".to_string()],
      Self::Claude => vec!["claude".to_string()],
    }
  }
}

/// Terminal metadata returned by the REST API.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Terminal {
  pub id: TerminalId,
  pub label: String,
  pub command: Vec<String>,
  pub status: TerminalStatus,
}

/// Request body for creating a new terminal.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreateTerminalRequest {
  pub command: TerminalCommand,
  /// Working directory. None = $HOME.
  pub cwd: Option<String>,
}

// ── WebSocket protocol ──

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
