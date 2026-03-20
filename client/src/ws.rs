//! WebSocket status types for the terminal connection.

use leptos_use::core::ConnectionReadyState;

/// WebSocket connection status, exposed as a signal for the UI header.
#[derive(Clone, Copy, PartialEq)]
pub enum WsStatus {
  Connecting,
  Open,
  Closed,
}

impl WsStatus {
  pub fn label(self) -> &'static str {
    match self {
      WsStatus::Connecting => "connecting",
      WsStatus::Open => "connected",
      WsStatus::Closed => "disconnected",
    }
  }

  pub fn css_color(self) -> &'static str {
    match self {
      WsStatus::Connecting => "text-yellow-400",
      WsStatus::Open => "text-green-400",
      WsStatus::Closed => "text-red-400",
    }
  }
}

impl From<ConnectionReadyState> for WsStatus {
  fn from(state: ConnectionReadyState) -> Self {
    match state {
      ConnectionReadyState::Connecting => WsStatus::Connecting,
      ConnectionReadyState::Open => WsStatus::Open,
      _ => WsStatus::Closed,
    }
  }
}
