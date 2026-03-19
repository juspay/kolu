mod pty;
mod state;
mod ws;

use axum::{routing::get, Router};
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

    // Spawn a single PTY running the user's shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let home = std::env::var("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap());

    let pty_handle = pty::spawn(
        &shell,
        &home,
        kolu_common::DEFAULT_COLS,
        kolu_common::DEFAULT_ROWS,
    )
    .expect("failed to spawn PTY");
    tracing::info!(shell = %shell, cwd = %home.display(), "PTY spawned");

    let state = AppState::new(pty_handle);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/ws/{terminal_id}", get(ws::ws_handler))
        .with_state(state)
        .fallback_service(ServeDir::new(client_dist));

    let addr: SocketAddr = format!("{}:{}", args.host, args.port).parse().unwrap();
    tracing::info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
