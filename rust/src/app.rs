use axum::{
    http::{Method, Uri},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};

use crate::{error::AppError, routes, state::AppState};

pub fn router() -> Router {
    Router::new()
        .route("/health", get(health))
        .merge(routes::users::router())
        .merge(routes::projects::router())
        .merge(routes::tasks::router())
        .merge(routes::comments::router())
        .merge(routes::tags::router())
        .merge(routes::reports::router())
        .fallback(no_route)
        .method_not_allowed_fallback(no_route)
        .with_state(AppState::new())
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn no_route(method: Method, uri: Uri) -> AppError {
    AppError::not_found(format!("No route for {method} {}", uri.path()))
}
