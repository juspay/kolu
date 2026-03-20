//! HTTP API handlers for terminal CRUD.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;

use kolu_common::CreateTerminalRequest;

use crate::state::AppState;
use crate::terminal;

/// POST /api/terminals — create a new terminal.
pub async fn create_terminal(
  State(state): State<AppState>,
  Json(req): Json<CreateTerminalRequest>,
) -> impl IntoResponse {
  let id = req.label.clone();
  let cwd = std::env::var("HOME")
    .map(std::path::PathBuf::from)
    .unwrap_or_else(|_| std::env::current_dir().unwrap());

  match terminal::create(&state, id, req.label, req.command, &cwd) {
    Ok(info) => (StatusCode::CREATED, Json(info)).into_response(),
    Err(e) => (StatusCode::CONFLICT, e.to_string()).into_response(),
  }
}

/// GET /api/terminals — list all terminals.
pub async fn list_terminals(State(state): State<AppState>) -> impl IntoResponse {
  Json(terminal::list(&state))
}

/// DELETE /api/terminals/:id — kill and remove a terminal.
pub async fn delete_terminal(
  State(state): State<AppState>,
  Path(id): Path<String>,
) -> impl IntoResponse {
  match terminal::kill(&state, &id) {
    Ok(()) => StatusCode::NO_CONTENT.into_response(),
    Err(e) => (StatusCode::NOT_FOUND, e.to_string()).into_response(),
  }
}
