mod api;
mod pty;
mod state;
mod terminal;
mod ws;

use axum::routing::{delete, get, post};
use axum::Router;
use clap::Parser;
use std::net::SocketAddr;
use tower_http::services::ServeDir;

use state::AppState;

#[derive(Parser)]
#[command(name = "kolu-server")]
struct Args {
  #[arg(long, default_value = "0.0.0.0")]
  host: String,
  #[arg(long, default_value = "7681")]
  port: u16,
}

async fn health() -> &'static str {
  kolu_common::hello()
}

#[tokio::main]
async fn main() {
  tracing_subscriber::fmt::init();

  let args = Args::parse();
  let client_dist =
    std::env::var("KOLU_CLIENT_DIST").unwrap_or_else(|_| "../client/dist".to_string());

  let state = AppState::new();

  // Spawn a default terminal so the user lands on a working shell
  let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
  let home = std::env::var("HOME")
    .map(std::path::PathBuf::from)
    .unwrap_or_else(|_| std::env::current_dir().unwrap());

  terminal::create(
    &state,
    "default".to_string(),
    "shell".to_string(),
    vec![shell.clone()],
    &home,
  )
  .expect("failed to create default terminal");
  tracing::info!(shell = %shell, cwd = %home.display(), "default terminal spawned");

  // Start background status sweep
  terminal::spawn_status_sweep(state.clone());

  let app = Router::new()
    .route("/api/health", get(health))
    .route("/api/terminals", get(api::list_terminals))
    .route("/api/terminals", post(api::create_terminal))
    .route("/api/terminals/{id}", delete(api::delete_terminal))
    .route("/ws/{terminal_id}", get(ws::ws_handler))
    .with_state(state)
    .fallback_service(ServeDir::new(client_dist));

  let addr: SocketAddr = format!("{}:{}", args.host, args.port).parse().unwrap();
  tracing::info!(%addr, "listening");
  let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
  axum::serve(listener, app).await.unwrap();
}
