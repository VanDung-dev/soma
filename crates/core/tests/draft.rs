use catalog::lesson::draft::{DraftRevision, next_revision, same_draft};

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
