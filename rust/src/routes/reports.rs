use std::collections::{BTreeMap, HashSet};

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::Serialize;

use crate::{
    error::{AppError, AppResult},
    models::Task,
    state::{AppState, Db},
    util::{days_between, find, is_date, QueryParams},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/reports/projects/{id}/summary", get(project_summary))
        .route("/reports/users/{id}/workload", get(user_workload))
        .route("/reports/overdue", get(overdue))
}

// Reports never read the clock. The caller passes the day to report on as ?asOf=YYYY-MM-DD.
fn read_as_of(query: &QueryParams) -> AppResult<String> {
    let as_of = query
        .get("asOf")
        .ok_or_else(|| AppError::validation("asOf is required"))?;
    if !is_date(as_of) {
        return Err(AppError::validation(
            "asOf must be a real calendar date in YYYY-MM-DD format",
        ));
    }
    Ok(as_of.to_string())
}

fn is_open(task: &Task) -> bool {
    task.status != "done"
}

fn is_overdue(task: &Task, as_of: &str) -> bool {
    is_open(task) && task.due_date.as_deref().is_some_and(|d| d < as_of)
}

fn active_project_ids(db: &Db) -> HashSet<u32> {
    db.projects
        .iter()
        .filter(|p| p.status == "active")
        .map(|p| p.id)
        .collect()
}

#[derive(Serialize, Default)]
struct ByStatus {
    todo: usize,
    in_progress: usize,
    done: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    project_id: u32,
    as_of: String,
    total: usize,
    by_status: ByStatus,
    overdue: usize,
    unassigned: usize,
    completion_percent: u32,
}

async fn project_summary(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: QueryParams,
) -> AppResult<Json<ProjectSummary>> {
    let db = state.db();
    let project = find(&db.projects, &id, "Project not found")?;
    let as_of = read_as_of(&query)?;
    let tasks: Vec<&Task> = db
        .tasks
        .iter()
        .filter(|t| t.project_id == project.id)
        .collect();
    let mut by_status = ByStatus::default();
    for t in &tasks {
        match t.status.as_str() {
            "todo" => by_status.todo += 1,
            "in_progress" => by_status.in_progress += 1,
            "done" => by_status.done += 1,
            _ => {}
        }
    }
    let total = tasks.len();
    let completion_percent = if total == 0 {
        0
    } else {
        (by_status.done as f64 / total as f64 * 100.0).round() as u32
    };
    Ok(Json(ProjectSummary {
        project_id: project.id,
        total,
        overdue: tasks.iter().filter(|t| is_overdue(t, &as_of)).count(),
        unassigned: tasks
            .iter()
            .filter(|t| is_open(t) && t.assignee_id.is_none())
            .count(),
        by_status,
        completion_percent,
        as_of,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectLoad {
    project_id: u32,
    project_name: String,
    open: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserWorkload {
    user_id: u32,
    as_of: String,
    open: usize,
    overdue: usize,
    due_next7_days: usize,
    by_project: Vec<ProjectLoad>,
}

// Archived projects are left out of workload and overdue reports.
async fn user_workload(
    State(state): State<AppState>,
    Path(id): Path<String>,
    query: QueryParams,
) -> AppResult<Json<UserWorkload>> {
    let db = state.db();
    let user = find(&db.users, &id, "User not found")?;
    let as_of = read_as_of(&query)?;
    let active = active_project_ids(&db);
    let open: Vec<&Task> = db
        .tasks
        .iter()
        .filter(|t| t.assignee_id == Some(user.id) && is_open(t) && active.contains(&t.project_id))
        .collect();
    let mut per_project: BTreeMap<u32, usize> = BTreeMap::new();
    for t in &open {
        *per_project.entry(t.project_id).or_default() += 1;
    }
    let by_project = per_project
        .into_iter()
        .map(|(project_id, count)| ProjectLoad {
            project_id,
            project_name: db
                .projects
                .iter()
                .find(|p| p.id == project_id)
                .map(|p| p.name.clone())
                .unwrap_or_default(),
            open: count,
        })
        .collect();
    let due_next7_days = open
        .iter()
        .filter(|t| {
            t.due_date
                .as_deref()
                .is_some_and(|d| (1..=7).contains(&days_between(&as_of, d)))
        })
        .count();
    Ok(Json(UserWorkload {
        user_id: user.id,
        open: open.len(),
        overdue: open.iter().filter(|t| is_overdue(t, &as_of)).count(),
        due_next7_days,
        by_project,
        as_of,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OverdueItem {
    task_id: u32,
    title: String,
    project_id: u32,
    assignee_id: Option<u32>,
    due_date: Option<String>,
    days_overdue: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OverdueReport {
    as_of: String,
    total: usize,
    items: Vec<OverdueItem>,
}

async fn overdue(
    State(state): State<AppState>,
    query: QueryParams,
) -> AppResult<Json<OverdueReport>> {
    let as_of = read_as_of(&query)?;
    let db = state.db();
    let active = active_project_ids(&db);
    let mut items: Vec<OverdueItem> = db
        .tasks
        .iter()
        .filter(|t| active.contains(&t.project_id) && is_overdue(t, &as_of))
        .map(|t| OverdueItem {
            task_id: t.id,
            title: t.title.clone(),
            project_id: t.project_id,
            assignee_id: t.assignee_id,
            days_overdue: days_between(t.due_date.as_deref().unwrap_or_default(), &as_of),
            due_date: t.due_date.clone(),
        })
        .collect();
    items.sort_by(|a, b| {
        b.days_overdue
            .cmp(&a.days_overdue)
            .then(a.task_id.cmp(&b.task_id))
    });
    Ok(Json(OverdueReport {
        total: items.len(),
        items,
        as_of,
    }))
}
