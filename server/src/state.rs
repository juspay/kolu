use std::sync::Arc;

use crate::pty::PtyHandle;

/// Shared application state, passed to all Axum handlers via `State<AppState>`.
///
/// Wraps internals in Arc so cloning is cheap (required by Axum's
/// `State` extractor which clones per-request).
/// Currently holds a single terminal — Phase 2 will expand to a map.
#[derive(Clone)]
pub struct AppState {
  inner: Arc<AppStateInner>,
}

/// The actual owned state behind the Arc.
struct AppStateInner {
  /// Handle to the shared PTY process (channels + scrollback).
  pty: PtyHandle,
}

impl AppState {
  pub fn new(pty: PtyHandle) -> Self {
    Self {
      inner: Arc::new(AppStateInner { pty }),
    }
  }

  pub fn pty(&self) -> &PtyHandle {
    &self.inner.pty
  }
}
