use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};

use crate::{
    error::{AppError, AppResult},
    models::Project,
    state::AppState,
    util::{find, find_index, now, paginate, JsonBody, Page, QueryParams, TextRule},
};

const STATUSES: &[&str] = &["active", "archived"];
const NOT_FOUND: &str = "Project not found";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/projects", get(list).post(create))
        .route("/projects/{id}", get(show).patch(update).delete(remove))
        .route("/projects/{id}/archive", post(archive))
}

/// express.json() rejects malformed JSON before any route logic runs, but the
/// "body must be an object" check happens inside the handler, after the lookups.
fn reject_invalid_json(body: &Result<JsonBody, AppError>) -> AppResult<()> {
    match body {
        Err(e) if e.code == "invalid_json" => Err(e.clone()),
        _ => Ok(()),
    }
}

fn assert_active(project: &Project) -> AppResult<()> {
    if project.status == "archived" {
        return Err(AppError::conflict("Project is archived"));
    }
    Ok(())
}

async fn list(State(state): State<AppState>, query: QueryParams) -> AppResult<Json<Page<Project>>> {
    let status = query.one_of("status", STATUSES)?;
    let owner_id = query.id_filter("ownerId")?;
    let db = state.db();
    let rows: Vec<Project> = db
        .projects
        .iter()
        .filter(|p| status.as_ref().is_none_or(|s| &p.status == s))
        .filter(|p| owner_id.is_none_or(|o| p.owner_id == o))
        .cloned()
        .collect();
    Ok(Json(paginate(rows, &query)?))
}

async fn show(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<Project>> {
    let db = state.db();
    Ok(Json(find(&db.projects, &id, NOT_FOUND)?.clone()))
}

async fn create(
    State(state): State<AppState>,
    body: JsonBody,
) -> AppResult<(StatusCode, Json<Project>)> {
    let name = body.required_text("name", TextRule::required(80))?;
    let description = body
        .text("description", TextRule::optional_allow_empty(500))?
        .unwrap_or_default();
    let owner_id = body.required_id("ownerId")?;
    let mut db = state.db();
    if !db.users.iter().any(|u| u.id == owner_id) {
        return Err(AppError::validation("ownerId does not match a user"));
    }
    let project = Project {
        id: db.next_project_id(),
        name,
        description,
        owner_id,
        status: "active".to_string(),
        created_at: now(),
    };
    db.projects.push(project.clone());
    Ok((StatusCode::CREATED, Json(project)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<JsonBody, AppError>,
) -> AppResult<Json<Project>> {
    reject_invalid_json(&body)?;
    let mut db = state.db();
    let index = find_index(&db.projects, &id, NOT_FOUND)?;
    assert_active(&db.projects[index])?;
    let body = body?;
    let name = body.text("name", TextRule::optional(80))?;
    let description = body.text("description", TextRule::optional_allow_empty(500))?;
    let project = &mut db.projects[index];
    if let Some(name) = name {
        project.name = name;
    }
    if let Some(description) = description {
        project.description = description;
    }
    Ok(Json(project.clone()))
}

async fn archive(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<JsonBody, AppError>,
) -> AppResult<Json<Project>> {
    reject_invalid_json(&body)?;
    let mut db = state.db();
    let index = find_index(&db.projects, &id, NOT_FOUND)?;
    let project = &mut db.projects[index];
    assert_active(project)?;
    project.status = "archived".to_string();
    Ok(Json(project.clone()))
}

/// Deleting a project also deletes its tasks and their comments.
async fn remove(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<JsonBody, AppError>,
) -> AppResult<StatusCode> {
    reject_invalid_json(&body)?;
    let mut db = state.db();
    let project_id = find(&db.projects, &id, NOT_FOUND)?.id;
    let task_ids: Vec<u32> = db
        .tasks
        .iter()
        .filter(|t| t.project_id == project_id)
        .map(|t| t.id)
        .collect();
    db.comments.retain(|c| !task_ids.contains(&c.task_id));
    db.tasks.retain(|t| t.project_id != project_id);
    db.projects.retain(|p| p.id != project_id);
    Ok(StatusCode::NO_CONTENT)
}
