use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};

use crate::{
    error::{AppError, AppResult},
    models::Task,
    state::{AppState, Db},
    util::{find, find_index, now, paginate, JsonBody, Page, QueryParams, TextRule},
};

const STATUSES: &[&str] = &["todo", "in_progress", "done"];
const TASK_NOT_FOUND: &str = "Task not found";
const TITLE: TextRule = TextRule::required(120);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tasks", get(list_all).post(create))
        .route("/projects/{id}/tasks", get(list_for_project))
        .route("/tasks/{id}", get(get_one).patch(update).delete(remove))
}

fn read_assignee(db: &Db, body: &JsonBody) -> AppResult<Option<Option<u32>>> {
    let assignee_id = body.nullable_id("assigneeId")?;
    if let Some(Some(id)) = assignee_id {
        if !db.users.iter().any(|u| u.id == id) {
            return Err(AppError::validation("assigneeId does not match a user"));
        }
    }
    Ok(assignee_id)
}

fn project_archived(db: &Db, project_id: u32) -> bool {
    db.projects
        .iter()
        .any(|p| p.id == project_id && p.status == "archived")
}

fn list_tasks(db: &Db, query: &QueryParams, project_id: Option<u32>) -> AppResult<Page<Task>> {
    let status = query.one_of("status", STATUSES)?;
    let assignee_id = query.id_filter("assigneeId")?;
    let tag_name = query.get("tag");
    let tag_id = tag_name.and_then(|name| db.tags.iter().find(|t| t.name == name).map(|t| t.id));
    let rows: Vec<Task> = db
        .tasks
        .iter()
        .filter(|t| {
            project_id.is_none_or(|id| t.project_id == id)
                && status.as_ref().is_none_or(|s| &t.status == s)
                && assignee_id.is_none_or(|id| t.assignee_id == Some(id))
                && (tag_name.is_none() || tag_id.is_some_and(|id| t.tag_ids.contains(&id)))
        })
        .map(Task::rendered)
        .collect();
    paginate(rows, query)
}

async fn list_all(
    State(state): State<AppState>,
    query: QueryParams,
) -> AppResult<Json<Page<Task>>> {
    let project_id = query.id_filter("projectId")?;
    let db = state.db();
    list_tasks(&db, &query, project_id).map(Json)
}

async fn list_for_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: QueryParams,
) -> AppResult<Json<Page<Task>>> {
    let db = state.db();
    let project_id = find(&db.projects, &id, "Project not found")?.id;
    list_tasks(&db, &query, Some(project_id)).map(Json)
}

async fn get_one(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<Task>> {
    let db = state.db();
    Ok(Json(find(&db.tasks, &id, TASK_NOT_FOUND)?.rendered()))
}

async fn create(
    State(state): State<AppState>,
    body: JsonBody,
) -> AppResult<(StatusCode, Json<Task>)> {
    let mut db = state.db();
    let project_id = body.required_id("projectId")?;
    let archived = match db.projects.iter().find(|p| p.id == project_id) {
        Some(p) => p.status == "archived",
        None => return Err(AppError::validation("projectId does not match a project")),
    };
    let title = body.required_text("title", TITLE)?;
    let status = body
        .one_of("status", STATUSES)?
        .unwrap_or_else(|| "todo".to_string());
    let assignee_id = read_assignee(&db, &body)?.flatten();
    let due_date = body.nullable_date("dueDate")?.flatten();
    if archived {
        return Err(AppError::conflict("Project is archived"));
    }
    let created_at = now();
    let task = Task {
        id: db.next_task_id(),
        project_id,
        title,
        status,
        assignee_id,
        due_date,
        tag_ids: Vec::new(),
        created_at: created_at.clone(),
        updated_at: created_at,
    };
    let rendered = task.rendered();
    db.tasks.push(task);
    Ok((StatusCode::CREATED, Json(rendered)))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: JsonBody,
) -> AppResult<Json<Task>> {
    let mut db = state.db();
    let index = find_index(&db.tasks, &id, TASK_NOT_FOUND)?;
    let title = body.text("title", TextRule::optional(120))?;
    let status = body.one_of("status", STATUSES)?;
    let assignee_id = read_assignee(&db, &body)?;
    let due_date = body.nullable_date("dueDate")?;
    if project_archived(&db, db.tasks[index].project_id) {
        return Err(AppError::conflict("Project is archived"));
    }
    let task = &mut db.tasks[index];
    if let Some(title) = title {
        task.title = title;
    }
    if let Some(status) = status {
        task.status = status;
    }
    if let Some(assignee_id) = assignee_id {
        task.assignee_id = assignee_id;
    }
    if let Some(due_date) = due_date {
        task.due_date = due_date;
    }
    task.updated_at = now();
    Ok(Json(task.rendered()))
}

async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<StatusCode> {
    let mut db = state.db();
    let task_id = find(&db.tasks, &id, TASK_NOT_FOUND)?.id;
    db.comments.retain(|c| c.task_id != task_id);
    db.tasks.retain(|t| t.id != task_id);
    Ok(StatusCode::NO_CONTENT)
}
