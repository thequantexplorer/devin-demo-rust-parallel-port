use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, put},
    Json, Router,
};
use serde::Serialize;

use crate::{
    error::{AppError, AppResult},
    models::{Tag, Task},
    state::{AppState, Db},
    util::{find, find_index, JsonBody, TextRule},
};

const TAG_NOT_FOUND: &str = "Tag not found";
const TASK_NOT_FOUND: &str = "Task not found";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tags", get(list_tags).post(create_tag))
        .route("/tags/{id}", delete(delete_tag))
        .route(
            "/tasks/{task_id}/tags/{tag_id}",
            put(add_task_tag).delete(remove_task_tag),
        )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TagOut {
    #[serde(flatten)]
    tag: Tag,
    task_count: usize,
}

fn render_tag(db: &Db, tag: &Tag) -> TagOut {
    TagOut {
        tag: tag.clone(),
        task_count: db
            .tasks
            .iter()
            .filter(|t| t.tag_ids.contains(&tag.id))
            .count(),
    }
}

fn is_tag_name(name: &str) -> bool {
    (1..=30).contains(&name.len())
        && name
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn is_color(color: &str) -> bool {
    let b = color.as_bytes();
    b.len() == 7 && b[0] == b'#' && b[1..].iter().all(u8::is_ascii_hexdigit)
}

// Tags are a short list, so it is not paginated. Sorted by name.
async fn list_tags(State(state): State<AppState>) -> Json<Vec<TagOut>> {
    let db = state.db();
    let mut rows: Vec<&Tag> = db.tags.iter().collect();
    rows.sort_by(|a, b| a.name.cmp(&b.name));
    Json(rows.into_iter().map(|t| render_tag(&db, t)).collect())
}

async fn create_tag(
    State(state): State<AppState>,
    body: JsonBody,
) -> AppResult<(StatusCode, Json<TagOut>)> {
    let name = body.required_text("name", TextRule::required_any())?;
    if !is_tag_name(&name) {
        return Err(AppError::validation(
            "name must be 1-30 lowercase letters, digits or dashes",
        ));
    }
    let color = body.required_text("color", TextRule::required_any())?;
    if !is_color(&color) {
        return Err(AppError::validation("color must look like #1a2b3c"));
    }
    let mut db = state.db();
    if db.tags.iter().any(|t| t.name == name) {
        return Err(AppError::conflict("A tag with this name already exists"));
    }
    let tag = Tag {
        id: db.next_tag_id(),
        name,
        color: color.to_lowercase(),
    };
    db.tags.push(tag.clone());
    Ok((StatusCode::CREATED, Json(render_tag(&db, &tag))))
}

async fn delete_tag(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let mut db = state.db();
    let index = find_index(&db.tags, &id, TAG_NOT_FOUND)?;
    let tag_id = db.tags.remove(index).id;
    for task in &mut db.tasks {
        task.tag_ids.retain(|t| *t != tag_id);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Finds the task and tag (task first, so an unknown task wins), then edits the task's tags.
fn edit_task_tags(
    state: &AppState,
    task_raw: &str,
    tag_raw: &str,
    edit: impl FnOnce(&mut Vec<u32>, u32),
) -> AppResult<Json<Task>> {
    let mut db = state.db();
    let task_index = find_index(&db.tasks, task_raw, TASK_NOT_FOUND)?;
    let tag_id = find(&db.tags, tag_raw, TAG_NOT_FOUND)?.id;
    let task = &mut db.tasks[task_index];
    edit(&mut task.tag_ids, tag_id);
    Ok(Json(task.rendered()))
}

// Adding a tag the task already has, or removing one it does not have, is not an error.
async fn add_task_tag(
    State(state): State<AppState>,
    Path((task_id, tag_id)): Path<(String, String)>,
) -> AppResult<Json<Task>> {
    edit_task_tags(&state, &task_id, &tag_id, |tag_ids, tag| {
        if !tag_ids.contains(&tag) {
            tag_ids.push(tag);
        }
    })
}

async fn remove_task_tag(
    State(state): State<AppState>,
    Path((task_id, tag_id)): Path<(String, String)>,
) -> AppResult<Json<Task>> {
    edit_task_tags(&state, &task_id, &tag_id, |tag_ids, tag| {
        tag_ids.retain(|t| *t != tag);
    })
}
