use serde::{Deserialize, Serialize};

/// Implemented by every stored record so shared helpers can look rows up by id.
pub trait HasId {
    fn id(&self) -> u32;
}

macro_rules! has_id {
    ($($t:ty),*) => {
        $(impl HasId for $t {
            fn id(&self) -> u32 {
                self.id
            }
        })*
    };
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: u32,
    pub name: String,
    pub email: String,
    /// `member` or `admin`.
    pub role: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: u32,
    pub name: String,
    pub description: String,
    pub owner_id: u32,
    /// `active` or `archived`.
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: u32,
    pub project_id: u32,
    pub title: String,
    /// `todo`, `in_progress` or `done`.
    pub status: String,
    pub assignee_id: Option<u32>,
    /// `YYYY-MM-DD`.
    pub due_date: Option<String>,
    /// Stored in the order tags were added; use [`Task::rendered`] for API output.
    pub tag_ids: Vec<u32>,
    pub created_at: String,
    pub updated_at: String,
}

impl Task {
    /// The task as the API returns it: `tagIds` sorted ascending.
    pub fn rendered(&self) -> Task {
        let mut task = self.clone();
        task.tag_ids.sort_unstable();
        task
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: u32,
    pub task_id: u32,
    pub author_id: u32,
    pub body: String,
    pub created_at: String,
    pub edited_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: u32,
    pub name: String,
    /// Lowercase `#rrggbb`.
    pub color: String,
}

has_id!(User, Project, Task, Comment, Tag);
