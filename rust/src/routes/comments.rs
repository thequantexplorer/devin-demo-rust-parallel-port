use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};

use crate::{
    error::{AppError, AppResult},
    models::Comment,
    state::AppState,
    util::{find, find_index, now, paginate, JsonBody, Page, QueryParams, TextRule},
};

const BODY_RULE: TextRule = TextRule::required(2000);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks/{id}/comments", get(list).post(create))
        .route("/comments/{id}", patch(update).delete(remove))
}

/// Express parses JSON before routing, so `invalid_json` wins over a 404; a
/// non-object body is only rejected once the path id has been resolved.
fn early_body(body: Result<JsonBody, AppError>) -> AppResult<Result<JsonBody, AppError>> {
    match body {
        Err(e) if e.code == "invalid_json" => Err(e),
        other => Ok(other),
    }
}

async fn list(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: QueryParams,
) -> AppResult<Json<Page<Comment>>> {
    let db = state.db();
    let task_id = find(&db.tasks, &id, "Task not found")?.id;
    let rows: Vec<Comment> = db
        .comments
        .iter()
        .filter(|c| c.task_id == task_id)
        .cloned()
        .collect();
    Ok(Json(paginate(rows, &query)?))
}

async fn create(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<JsonBody, AppError>,
) -> AppResult<(StatusCode, Json<Comment>)> {
    let body = early_body(body)?;
    let mut db = state.db();
    let task_id = find(&db.tasks, &id, "Task not found")?.id;
    let body = body?;
    let author_id = body.required_id("authorId")?;
    if !db.users.iter().any(|u| u.id == author_id) {
        return Err(AppError::validation("authorId does not match a user"));
    }
    let text = body.required_text("body", BODY_RULE)?;
    let comment = Comment {
        id: db.next_comment_id(),
        task_id,
        author_id,
        body: text,
        created_at: now(),
        edited_at: None,
    };
    db.comments.push(comment.clone());
    Ok((StatusCode::CREATED, Json(comment)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<JsonBody, AppError>,
) -> AppResult<Json<Comment>> {
    let body = early_body(body)?;
    let mut db = state.db();
    let index = find_index(&db.comments, &id, "Comment not found")?;
    let text = body?.required_text("body", BODY_RULE)?;
    let comment = &mut db.comments[index];
    comment.body = text;
    comment.edited_at = Some(now());
    Ok(Json(comment.clone()))
}

async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<StatusCode> {
    let mut db = state.db();
    let index = find_index(&db.comments, &id, "Comment not found")?;
    db.comments.remove(index);
    Ok(StatusCode::NO_CONTENT)
}
