use std::sync::Arc;

use dashmap::DashMap;
use kolu_common::TerminalId;

use crate::terminal::LiveTerminal;

/// Shared application state, passed to all Axum handlers via `State<AppState>`.
///
/// Wraps internals in Arc so cloning is cheap (required by Axum's
/// `State` extractor which clones per-request).
#[derive(Clone)]
pub struct AppState {
  inner: Arc<AppStateInner>,
}

struct AppStateInner {
  terminals: DashMap<TerminalId, LiveTerminal>,
}

impl AppState {
  pub fn new() -> Self {
    Self {
      inner: Arc::new(AppStateInner {
        terminals: DashMap::new(),
      }),
    }
  }

  pub fn terminals(&self) -> &DashMap<TerminalId, LiveTerminal> {
    &self.inner.terminals
  }
}
