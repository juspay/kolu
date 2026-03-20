//! WebSocket status tracking.

/// Connection status for the active terminal's WebSocket.
#[derive(Clone, Debug, PartialEq)]
pub enum WsStatus {
  Connecting,
  Open,
  Closed,
}

impl WsStatus {
  pub fn label(&self) -> &'static str {
    match self {
      Self::Connecting => "connecting",
      Self::Open => "connected",
      Self::Closed => "disconnected",
    }
  }

  pub fn css_color(&self) -> &'static str {
    match self {
      Self::Connecting => "text-yellow-400",
      Self::Open => "text-green-400",
      Self::Closed => "text-red-400",
    }
  }
}
