use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftRevision {
    pub version: u64,
    pub created_at: Option<u64>,
    pub updated_at: Option<u64>,
}

pub fn next_revision(version: u64, previous: Option<DraftRevision>, now: u64) -> DraftRevision {
    DraftRevision {
        version: previous
            .as_ref()
            .map_or(version, |draft| draft.version.saturating_add(1)),
        created_at: previous.map_or(Some(now), |draft| draft.created_at),
        updated_at: Some(now),
    }
}

pub fn same_draft(
    current: Option<&str>,
    expected: Option<&str>,
) -> Result<bool, serde_json::Error> {
    let parse = |data: &str| serde_json::from_str::<Value>(data);
    Ok(current.map(parse).transpose()? == expected.map(parse).transpose()?)
}
