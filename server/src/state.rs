use std::sync::Arc;

use crate::pty::PtyHandle;

/// Shared application state, passed to all Axum handlers via `State<AppState>`.
/// Currently holds a single terminal — Phase 2 will expand to a map.
#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

struct AppStateInner {
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
