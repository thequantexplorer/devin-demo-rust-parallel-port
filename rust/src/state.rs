use std::sync::{Arc, Mutex, MutexGuard};

use serde::Deserialize;

use crate::models::{Comment, HasId, Project, Tag, Task, User};

const SEED: &str = include_str!("../../data/seed.json");

/// The whole data set, in memory. Every start loads a fresh copy of data/seed.json.
#[derive(Debug, Deserialize)]
pub struct Db {
    pub users: Vec<User>,
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    pub comments: Vec<Comment>,
    pub tags: Vec<Tag>,
    #[serde(skip)]
    last_ids: LastIds,
}

#[derive(Debug, Default)]
struct LastIds {
    users: u32,
    projects: u32,
    tasks: u32,
    comments: u32,
    tags: u32,
}

fn max_id<T: HasId>(rows: &[T]) -> u32 {
    rows.iter().map(HasId::id).max().unwrap_or(0)
}

impl Db {
    pub fn from_seed() -> Self {
        let mut db: Db = serde_json::from_str(SEED).expect("data/seed.json is valid");
        db.last_ids = LastIds {
            users: max_id(&db.users),
            projects: max_id(&db.projects),
            tasks: max_id(&db.tasks),
            comments: max_id(&db.comments),
            tags: max_id(&db.tags),
        };
        db
    }

    // Ids are never reused, even after a delete.
    pub fn next_user_id(&mut self) -> u32 {
        self.last_ids.users += 1;
        self.last_ids.users
    }

    pub fn next_project_id(&mut self) -> u32 {
        self.last_ids.projects += 1;
        self.last_ids.projects
    }

    pub fn next_task_id(&mut self) -> u32 {
        self.last_ids.tasks += 1;
        self.last_ids.tasks
    }

    pub fn next_comment_id(&mut self) -> u32 {
        self.last_ids.comments += 1;
        self.last_ids.comments
    }

    pub fn next_tag_id(&mut self) -> u32 {
        self.last_ids.tags += 1;
        self.last_ids.tags
    }
}

#[derive(Clone)]
pub struct AppState {
    db: Arc<Mutex<Db>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            db: Arc::new(Mutex::new(Db::from_seed())),
        }
    }

    /// Locks the data set. Do not hold the guard across an `.await`.
    pub fn db(&self) -> MutexGuard<'_, Db> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
