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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_revisions_preserve_creation_dates_including_legacy_absence() {
        let revision = next_revision(2, None, 1000);
        assert_eq!(
            (revision.version, revision.created_at, revision.updated_at),
            (2, Some(1000), Some(1000))
        );
        let revision = next_revision(1, Some(revision), 2000);
        assert_eq!(
            (revision.version, revision.created_at, revision.updated_at),
            (3, Some(1000), Some(2000))
        );
        let legacy = DraftRevision {
            version: 3,
            created_at: None,
            updated_at: None,
        };
        assert_eq!(next_revision(3, Some(legacy), 3000).created_at, None);
    }

    #[test]
    fn draft_comparison_ignores_property_order_and_detects_changes() {
        assert!(
            same_draft(
                Some(r#"{"version":1,"steps":[]}"#),
                Some(r#"{"steps":[],"version":1}"#)
            )
            .unwrap()
        );
        assert!(!same_draft(Some(r#"{"version":2}"#), Some(r#"{"version":1}"#)).unwrap());
        assert!(!same_draft(None, Some("{}")).unwrap());
    }
}
