use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};

use crate::{
    error::{AppError, AppResult},
    models::User,
    state::{AppState, Db},
    util::{find, find_index, now, paginate, JsonBody, Page, QueryParams, TextRule},
};

const ROLES: &[&str] = &["member", "admin"];
const USER_NOT_FOUND: &str = "User not found";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users", get(list_users).post(create_user))
        .route(
            "/users/{id}",
            get(get_user).patch(update_user).delete(delete_user),
        )
}

fn is_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

/// Same as the Node check `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`.
fn is_email(email: &str) -> bool {
    if email.chars().any(is_space) {
        return false;
    }
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    if local.is_empty() || domain.contains('@') {
        return false;
    }
    domain
        .char_indices()
        .any(|(i, c)| c == '.' && i > 0 && i + 1 < domain.len())
}

fn read_email(body: &JsonBody, required: bool) -> AppResult<Option<String>> {
    let rule = TextRule {
        required,
        ..TextRule::optional(254)
    };
    let Some(raw) = body.text("email", rule)? else {
        return Ok(None);
    };
    let email = raw.to_lowercase();
    if !is_email(&email) {
        return Err(AppError::validation("email is not a valid address"));
    }
    Ok(Some(email))
}

fn assert_email_free(db: &Db, email: &str, except_id: Option<u32>) -> AppResult<()> {
    if db
        .users
        .iter()
        .any(|u| u.email == email && Some(u.id) != except_id)
    {
        return Err(AppError::conflict("A user with this email already exists"));
    }
    Ok(())
}

async fn list_users(
    State(state): State<AppState>,
    query: QueryParams,
) -> AppResult<Json<Page<User>>> {
    let role = query.one_of("role", ROLES)?;
    let db = state.db();
    let rows = db
        .users
        .iter()
        .filter(|u| role.as_deref().is_none_or(|r| u.role == r))
        .cloned()
        .collect();
    Ok(Json(paginate(rows, &query)?))
}

async fn get_user(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<User>> {
    let db = state.db();
    Ok(Json(find(&db.users, &id, USER_NOT_FOUND)?.clone()))
}

async fn create_user(
    State(state): State<AppState>,
    body: JsonBody,
) -> AppResult<(StatusCode, Json<User>)> {
    let name = body.required_text("name", TextRule::required(80))?;
    let email = read_email(&body, true)?.expect("required");
    let role = body
        .one_of("role", ROLES)?
        .unwrap_or_else(|| "member".to_string());
    let mut db = state.db();
    assert_email_free(&db, &email, None)?;
    let user = User {
        id: db.next_user_id(),
        name,
        email,
        role,
        created_at: now(),
    };
    db.users.push(user.clone());
    Ok((StatusCode::CREATED, Json(user)))
}

async fn update_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Result<JsonBody, AppError>,
) -> AppResult<Json<User>> {
    // Unparseable JSON is rejected before routing in Node; other body errors come after the lookup.
    let body = match body {
        Err(e) if e.code == "invalid_json" => return Err(e),
        other => other,
    };
    let mut db = state.db();
    let index = find_index(&db.users, &id, USER_NOT_FOUND)?;
    let body = body?;
    let name = body.text("name", TextRule::optional(80))?;
    let email = read_email(&body, false)?;
    let role = body.one_of("role", ROLES)?;
    if let Some(email) = &email {
        assert_email_free(&db, email, Some(db.users[index].id))?;
    }
    let user = &mut db.users[index];
    if let Some(name) = name {
        user.name = name;
    }
    if let Some(email) = email {
        user.email = email;
    }
    if let Some(role) = role {
        user.role = role;
    }
    Ok(Json(user.clone()))
}

async fn delete_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    let mut db = state.db();
    let index = find_index(&db.users, &id, USER_NOT_FOUND)?;
    let user_id = db.users[index].id;
    if db.projects.iter().any(|p| p.owner_id == user_id) {
        return Err(AppError::conflict("User still owns projects"));
    }
    if db
        .tasks
        .iter()
        .any(|t| t.assignee_id == Some(user_id) && t.status != "done")
    {
        return Err(AppError::conflict("User still has open tasks"));
    }
    db.users.remove(index);
    Ok(StatusCode::NO_CONTENT)
}
