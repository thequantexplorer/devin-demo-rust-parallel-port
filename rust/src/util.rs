//! Shared helpers for the domain routers: JSON bodies, path ids, query strings,
//! paging, dates and timestamps. They mirror src/lib/*.js.

use axum::{
    body::Bytes,
    extract::{FromRequest, FromRequestParts, Query, Request},
    http::{header::CONTENT_TYPE, request::Parts},
};
use chrono::{NaiveDate, SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{Map, Value};

use crate::{error::AppError, error::AppResult, models::HasId};

// ---------------------------------------------------------------------------
// Timestamps and dates

/// Current time like `2026-03-01T09:00:00.000Z`.
pub fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn parse_date(value: &str) -> Option<NaiveDate> {
    let b = value.as_bytes();
    let shape = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    if !shape {
        return None;
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

/// True for a real calendar date in `YYYY-MM-DD` form (`2026-02-30` is false).
pub fn is_date(value: &str) -> bool {
    parse_date(value).is_some()
}

/// Whole days from `a` to `b` (positive when `b` is later). Both must be valid dates.
pub fn days_between(a: &str, b: &str) -> i64 {
    match (parse_date(a), parse_date(b)) {
        (Some(a), Some(b)) => (b - a).num_days(),
        _ => 0,
    }
}

// ---------------------------------------------------------------------------
// Path ids

/// Path ids are positive whole numbers. Anything else (`abc`, `0`, `1.5`, `-2`)
/// matches no record, so callers answer 404, not 400.
pub fn parse_id(raw: &str) -> Option<u32> {
    let b = raw.as_bytes();
    if b.is_empty() || b[0] == b'0' || !b.iter().all(u8::is_ascii_digit) {
        return None;
    }
    raw.parse().ok()
}

/// Index of the row whose id is the path segment `raw`, or a 404 `not_found`
/// with `message` (for example `"User not found"`).
pub fn find_index<T: HasId>(rows: &[T], raw: &str, message: &str) -> AppResult<usize> {
    parse_id(raw)
        .and_then(|id| rows.iter().position(|r| r.id() == id))
        .ok_or_else(|| AppError::not_found(message))
}

/// Like [`find_index`], but returns the row.
pub fn find<'a, T: HasId>(rows: &'a [T], raw: &str, message: &str) -> AppResult<&'a T> {
    find_index(rows, raw, message).map(|i| &rows[i])
}

// ---------------------------------------------------------------------------
// JSON bodies

/// The request body as a JSON object. Use it as the last handler argument.
///
/// - Not valid JSON (or a top-level value that is not an object or array) -> 400 `invalid_json`.
/// - Valid JSON that is not an object -> 400 `validation_failed`.
/// - No body, or a content type that is not JSON -> an empty object.
///
/// Read fields with the typed getters below; they give `validation_failed` for a wrong
/// type, so `"name": 42` is never `invalid_json`. Unknown fields are ignored.
#[derive(Debug, Default, Clone)]
pub struct JsonBody(pub Map<String, Value>);

impl<S: Send + Sync> FromRequest<S> for JsonBody {
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let is_json = req
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|v| {
                v.split(';')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .eq_ignore_ascii_case("application/json")
            })
            .unwrap_or(false);
        let bytes = Bytes::from_request(req, state)
            .await
            .map_err(|_| AppError::invalid_json())?;
        if !is_json || bytes.is_empty() {
            return Ok(Self::default());
        }
        // Like express.json() in strict mode: only objects and arrays are accepted.
        let first = bytes
            .iter()
            .find(|c| !matches!(c, b' ' | b'\t' | b'\n' | b'\r'));
        if !matches!(first, Some(b'{') | Some(b'[')) {
            return Err(AppError::invalid_json());
        }
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(Value::Object(map)) => Ok(Self(map)),
            Ok(_) => Err(AppError::validation("Request body must be a JSON object")),
            Err(_) => Err(AppError::invalid_json()),
        }
    }
}

/// Length rules for [`JsonBody::text`]. Lengths count characters after trimming.
#[derive(Debug, Clone, Copy)]
pub struct TextRule {
    pub required: bool,
    /// Minimum length; 1 means "must not be empty", 0 allows `""`.
    pub min: usize,
    pub max: Option<usize>,
}

impl TextRule {
    /// Required, 1..=max characters.
    pub const fn required(max: usize) -> Self {
        Self {
            required: true,
            min: 1,
            max: Some(max),
        }
    }
    /// Optional, 1..=max characters.
    pub const fn optional(max: usize) -> Self {
        Self {
            required: false,
            min: 1,
            max: Some(max),
        }
    }
    /// Optional, 0..=max characters (an empty string is allowed).
    pub const fn optional_allow_empty(max: usize) -> Self {
        Self {
            required: false,
            min: 0,
            max: Some(max),
        }
    }
    /// Required, any non-empty length.
    pub const fn required_any() -> Self {
        Self {
            required: true,
            min: 1,
            max: None,
        }
    }
}

fn as_positive_id(value: &Value) -> Option<u32> {
    if let Some(n) = value.as_u64() {
        return u32::try_from(n).ok().filter(|n| *n >= 1);
    }
    let f = value.as_f64()?;
    (f >= 1.0 && f.fract() == 0.0 && f <= u32::MAX as f64).then_some(f as u32)
}

impl JsonBody {
    pub fn get(&self, field: &str) -> Option<&Value> {
        self.0.get(field)
    }

    /// True when the field is present (even if it is `null`).
    pub fn has(&self, field: &str) -> bool {
        self.0.contains_key(field)
    }

    /// A trimmed string. `Ok(None)` when absent and not required.
    pub fn text(&self, field: &str, rule: TextRule) -> AppResult<Option<String>> {
        let Some(value) = self.get(field) else {
            if rule.required {
                return Err(AppError::validation(format!("{field} is required")));
            }
            return Ok(None);
        };
        let Value::String(s) = value else {
            return Err(AppError::validation(format!("{field} must be a string")));
        };
        let trimmed = s.trim();
        let len = trimmed.chars().count();
        if len < rule.min {
            return Err(AppError::validation(format!("{field} must not be empty")));
        }
        if let Some(max) = rule.max {
            if len > max {
                return Err(AppError::validation(format!(
                    "{field} must be at most {max} characters"
                )));
            }
        }
        Ok(Some(trimmed.to_string()))
    }

    /// A required trimmed string (see [`TextRule`]; `rule.required` is ignored).
    pub fn required_text(&self, field: &str, rule: TextRule) -> AppResult<String> {
        let rule = TextRule {
            required: true,
            ..rule
        };
        Ok(self.text(field, rule)?.expect("required"))
    }

    /// A positive whole number. `Ok(None)` when absent. `null` is a validation error.
    pub fn id(&self, field: &str) -> AppResult<Option<u32>> {
        match self.get(field) {
            None => Ok(None),
            Some(v) => as_positive_id(v).map(Some).ok_or_else(|| {
                AppError::validation(format!("{field} must be a positive whole number"))
            }),
        }
    }

    /// A required positive whole number.
    pub fn required_id(&self, field: &str) -> AppResult<u32> {
        self.id(field)?
            .ok_or_else(|| AppError::validation(format!("{field} is required")))
    }

    /// PATCH-style id: `None` = absent (leave alone), `Some(None)` = explicit `null`
    /// (clear), `Some(Some(id))` = set.
    pub fn nullable_id(&self, field: &str) -> AppResult<Option<Option<u32>>> {
        match self.get(field) {
            None => Ok(None),
            Some(Value::Null) => Ok(Some(None)),
            Some(_) => Ok(Some(self.id(field)?)),
        }
    }

    /// PATCH-style `YYYY-MM-DD` date: same three states as [`JsonBody::nullable_id`].
    pub fn nullable_date(&self, field: &str) -> AppResult<Option<Option<String>>> {
        match self.get(field) {
            None => Ok(None),
            Some(Value::Null) => Ok(Some(None)),
            Some(Value::String(s)) if is_date(s) => Ok(Some(Some(s.clone()))),
            Some(_) => Err(AppError::validation(format!(
                "{field} must be a real calendar date in YYYY-MM-DD format"
            ))),
        }
    }

    /// One of `allowed`. `Ok(None)` when absent; any other value (including `null`) fails.
    pub fn one_of(&self, field: &str, allowed: &[&str]) -> AppResult<Option<String>> {
        match self.get(field) {
            None => Ok(None),
            Some(Value::String(s)) if allowed.contains(&s.as_str()) => Ok(Some(s.clone())),
            Some(_) => Err(one_of_error(field, allowed)),
        }
    }
}

fn one_of_error(name: &str, allowed: &[&str]) -> AppError {
    AppError::validation(format!("{name} must be one of: {}", allowed.join(", ")))
}

// ---------------------------------------------------------------------------
// Query strings

/// The decoded query string. Use it instead of `Query<T>` so bad values are
/// JSON `validation_failed` errors. When a key repeats, the last value wins.
#[derive(Debug, Default, Clone)]
pub struct QueryParams(pub Vec<(String, String)>);

impl<S: Send + Sync> FromRequestParts<S> for QueryParams {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Query::<Vec<(String, String)>>::try_from_uri(&parts.uri)
            .map(|Query(pairs)| Self(pairs))
            .map_err(|_| AppError::validation("Query string is not valid"))
    }
}

impl QueryParams {
    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .rev()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    /// One of `allowed`, or `None` when absent.
    pub fn one_of(&self, name: &str, allowed: &[&str]) -> AppResult<Option<String>> {
        match self.get(name) {
            None => Ok(None),
            Some(v) if allowed.contains(&v) => Ok(Some(v.to_string())),
            Some(_) => Err(one_of_error(name, allowed)),
        }
    }

    /// An id filter such as `?ownerId=2`. Not a positive whole number -> `validation_failed`.
    pub fn id_filter(&self, name: &str) -> AppResult<Option<u32>> {
        match self.get(name) {
            None => Ok(None),
            Some(v) => parse_id(v).map(Some).ok_or_else(|| {
                AppError::validation(format!("{name} must be a positive whole number"))
            }),
        }
    }

    fn whole_number(&self, name: &str, fallback: usize) -> AppResult<usize> {
        match self.get(name) {
            None => Ok(fallback),
            Some(v) if !v.is_empty() && v.bytes().all(|c| c.is_ascii_digit()) => {
                Ok(v.parse().unwrap_or(usize::MAX))
            }
            Some(_) => Err(AppError::validation(format!(
                "{name} must be a whole number"
            ))),
        }
    }

    /// `limit` (default 20, 1 to 100) and `offset` (default 0).
    pub fn page(&self) -> AppResult<(usize, usize)> {
        let limit = self.whole_number("limit", DEFAULT_LIMIT)?;
        let offset = self.whole_number("offset", 0)?;
        if !(1..=MAX_LIMIT).contains(&limit) {
            return Err(AppError::validation(format!(
                "limit must be between 1 and {MAX_LIMIT}"
            )));
        }
        Ok((limit, offset))
    }
}

// ---------------------------------------------------------------------------
// Paging

pub const DEFAULT_LIMIT: usize = 20;
pub const MAX_LIMIT: usize = 100;

/// The list envelope every paged endpoint returns.
#[derive(Debug, Serialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

/// Reads `limit`/`offset` from the query and slices `rows` (already filtered and ordered).
pub fn paginate<T>(rows: Vec<T>, query: &QueryParams) -> AppResult<Page<T>> {
    let (limit, offset) = query.page()?;
    let total = rows.len();
    let items = rows.into_iter().skip(offset).take(limit).collect();
    Ok(Page {
        items,
        total,
        limit,
        offset,
    })
}
