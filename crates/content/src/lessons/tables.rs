use super::Files;
use catalog::lesson::section_reference;
use serde::{Deserialize, Serialize};
use serde_json::{Value, value::RawValue};
use std::collections::BTreeMap;

pub(super) const SCENES: Table = Table {
    path: super::scenes::PATH,
    ref_key: "sceneRef",
};
pub(super) const QUESTIONS: Table = Table {
    path: "questions.jsonl",
    ref_key: "questionRef",
};

pub(super) struct Table {
    pub path: &'static str,
    ref_key: &'static str,
}

#[derive(Deserialize, Serialize)]
struct Row<'a> {
    section: &'a str,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reference: Option<&'a str>,
    #[serde(default, skip_serializing_if = "is_first")]
    order: usize,
    #[serde(borrow)]
    record: &'a RawValue,
}

fn is_first(order: &usize) -> bool {
    *order == 0
}

impl Table {
    pub fn is_referenced(&self, lesson: &Value) -> bool {
        lesson.get(self.ref_key).is_some()
            || lesson["steps"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|step| step.get(self.ref_key).is_some())
    }

    fn references<'a>(&self, lesson: &'a Value) -> Result<BTreeMap<&'a str, &'a str>, String> {
        let mut references = BTreeMap::new();
        let nodes = std::iter::once(lesson).chain(lesson["steps"].as_array().into_iter().flatten());
        for (index, node) in nodes.enumerate() {
            let Some(value) = node.get(self.ref_key) else {
                continue;
            };
            let reference = value
                .as_str()
                .filter(|value| section_reference(value))
                .ok_or("Invalid lesson table reference")?;
            let section = if index == 0 {
                ""
            } else {
                node["id"].as_str().ok_or("Missing lesson section ID")?
            };
            if references.insert(section, reference).is_some() {
                return Err("Duplicate lesson table section".into());
            }
        }
        Ok(references)
    }

    pub fn pack(
        &self,
        lesson: &Value,
        sections: &mut Files,
        archive: &mut Files,
    ) -> Result<(), String> {
        self.write(lesson, sections, archive, false)
    }

    pub fn pack_draft(
        &self,
        lesson: &Value,
        sections: &mut Files,
        tables: &mut Files,
    ) -> Result<(), String> {
        self.write(lesson, sections, tables, true)
    }

    fn write(
        &self,
        lesson: &Value,
        sections: &mut Files,
        tables: &mut Files,
        versioned: bool,
    ) -> Result<(), String> {
        let mut table = Vec::new();
        for (section, reference) in self.references(lesson)? {
            let Some(bytes) = sections.remove(reference) else {
                continue;
            };
            let rows = if bytes.is_empty() {
                &b"null"[..]
            } else {
                bytes.strip_suffix(b"\n").unwrap_or(&bytes)
            };
            for (order, line) in rows.split(|byte| *byte == b'\n').enumerate() {
                let record = serde_json::from_slice(line).map_err(|error| error.to_string())?;
                serde_json::to_writer(
                    &mut table,
                    &Row {
                        section,
                        reference: versioned.then_some(reference),
                        order,
                        record,
                    },
                )
                .map_err(|error| error.to_string())?;
                table.push(b'\n');
            }
        }
        if !table.is_empty() {
            tables.insert(self.path.into(), table);
        }
        Ok(())
    }

    pub fn unpack(&self, lesson: &Value, bytes: &[u8]) -> Result<Files, String> {
        self.read(lesson, bytes, false)
    }

    pub fn unpack_draft(&self, lesson: &Value, bytes: &[u8]) -> Result<Files, String> {
        self.read(lesson, bytes, true)
    }

    fn read(&self, lesson: &Value, bytes: &[u8], versioned: bool) -> Result<Files, String> {
        let references = self.references(lesson)?;
        let mut rows = BTreeMap::<&str, Vec<(usize, &str)>>::new();
        for line in bytes.split(|byte| *byte == b'\n') {
            let Ok(row) = serde_json::from_slice::<Row<'_>>(line) else {
                continue;
            };
            if let Some(reference) = references.get(row.section)
                && (!versioned || row.reference == Some(*reference))
            {
                rows.entry(reference)
                    .or_default()
                    .push((row.order, row.record.get()));
            }
        }
        let mut files = Files::new();
        for (reference, mut rows) in rows {
            rows.sort_unstable_by_key(|(order, _)| *order);
            if rows.iter().enumerate().any(|(i, (order, _))| i != *order) {
                continue;
            }
            let mut bytes = Vec::new();
            if rows.as_slice() != [(0, "null")] {
                for (_, record) in rows {
                    bytes.extend_from_slice(record.as_bytes());
                    bytes.push(b'\n');
                }
            }
            files.insert(reference.to_owned(), bytes);
        }
        Ok(files)
    }
}
