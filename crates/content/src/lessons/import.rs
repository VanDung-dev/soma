use super::{check_image_collection, image_fingerprint};
use serde_json::Value;
use std::collections::HashMap;

pub fn image_aliases<T: AsRef<[u8]>>(
    existing: impl IntoIterator<Item = (String, T)>,
    incoming: impl IntoIterator<Item = (String, T)>,
) -> Result<Vec<(String, String)>, String> {
    let mut canonical = HashMap::new();
    for (path, bytes) in existing {
        canonical.insert(image_fingerprint(bytes.as_ref())?, path);
    }
    let mut aliases = Vec::new();
    for (path, bytes) in incoming {
        match canonical.entry(image_fingerprint(bytes.as_ref())?) {
            std::collections::hash_map::Entry::Occupied(entry) => {
                aliases.push((path, entry.get().clone()));
            }
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(path);
            }
        }
    }
    Ok(aliases)
}

pub fn imported_image_additions(
    lesson: &Value,
    existing: HashMap<String, usize>,
    incoming: HashMap<String, usize>,
) -> Result<Vec<String>, String> {
    let retained = catalog::lesson::image_paths(lesson)
        .into_iter()
        .map(|path| {
            let size = incoming
                .get(&path)
                .or_else(|| existing.get(&path))
                .copied()
                .ok_or("Imported lesson references a missing image.")?;
            Ok((path, size))
        })
        .collect::<Result<Vec<_>, &str>>()?;
    check_image_collection(&retained)?;
    Ok(retained
        .into_iter()
        .filter_map(|(path, _)| (!existing.contains_key(&path)).then_some(path))
        .collect())
}
