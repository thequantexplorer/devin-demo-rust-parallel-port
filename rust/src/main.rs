mod app;
// Shared helpers are filled in for every domain; not each one is used by every build.
#[allow(dead_code)]
mod error;
#[allow(dead_code)]
mod models;
mod routes;
#[allow(dead_code)]
mod state;
#[allow(dead_code)]
mod util;

use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("could not bind {addr}: {e}"));
    println!("tracker-api (rust) listening on http://{addr}");
    axum::serve(listener, app::router())
        .await
        .expect("server error");
}
