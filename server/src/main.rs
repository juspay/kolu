use axum::{routing::get, Router};
use clap::Parser;
use std::net::SocketAddr;
use tower_http::services::ServeDir;

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
    let args = Args::parse();
    let client_dist =
        std::env::var("KOLU_CLIENT_DIST").unwrap_or_else(|_| "../client/dist".to_string());

    let app = Router::new()
        .route("/api/health", get(health))
        .fallback_service(ServeDir::new(client_dist));

    let addr: SocketAddr = format!("{}:{}", args.host, args.port).parse().unwrap();
    println!("listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
