use super::{check_image_collection, image_fingerprint};
use dom_query::Document;
use html5ever::{ParseOpts, QualName, local_name, ns, parse_fragment, tendril::TendrilSink};
use serde_json::Value;
use std::collections::HashMap;

pub fn prepare_image_import<T: AsRef<[u8]>>(
    mut lesson: Value,
    stored: HashMap<String, usize>,
    existing: impl IntoIterator<Item = (String, T)>,
    incoming: impl IntoIterator<Item = (String, T)>,
) -> Result<(Value, Vec<String>), String> {
    let mut incoming = incoming.into_iter().peekable();
    let mut sizes = HashMap::new();
    if incoming.peek().is_some() {
        let aliases = image_aliases(
            existing,
            incoming.inspect(|(path, bytes)| {
                sizes.insert(path.clone(), bytes.as_ref().len());
            }),
        )?;
        let aliases = aliases
            .into_iter()
            .filter(|(from, to)| from != to)
            .collect();
        replace_image_sources(&mut lesson, &aliases)?;
    }
    let additions = imported_image_additions(&lesson, stored, sizes)?;
    Ok((lesson, additions))
}

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

fn replace_image_sources(
    lesson: &mut Value,
    aliases: &HashMap<String, String>,
) -> Result<(), String> {
    if aliases.is_empty() {
        return Ok(());
    }
    if let Some(Value::String(path)) = lesson.get_mut("cover")
        && let Some(replacement) = aliases.get(path.as_str())
    {
        path.clone_from(replacement);
    }
    let mut pending = vec![lesson];
    while let Some(value) = pending.pop() {
        match value {
            Value::Array(items) => pending.extend(items),
            Value::Object(fields) => {
                for language in ["vi", "en"] {
                    if fields
                        .get("html")
                        .and_then(Value::as_array)
                        .is_some_and(|locales| {
                            locales
                                .iter()
                                .any(|locale| locale.as_str() == Some(language))
                        })
                        && let Some(Value::String(html)) = fields.get_mut(language)
                        && let Some(rewritten) = rewrite_html_images(html, aliases)?
                    {
                        *html = rewritten;
                    }
                }
                pending.extend(fields.values_mut());
            }
            _ => {}
        }
    }
    Ok(())
}

fn rewrite_html_images(
    html: &str,
    aliases: &HashMap<String, String>,
) -> Result<Option<String>, String> {
    if !html.as_bytes().windows(5).any(|bytes| {
        bytes[..4].eq_ignore_ascii_case(b"<img")
            && (bytes[4].is_ascii_whitespace() || matches!(bytes[4], b'/' | b'>'))
    }) {
        return Ok(None);
    }
    let document = parse_fragment(
        Document::fragment_sink(),
        ParseOpts {
            tree_builder: html5ever::tree_builder::TreeBuilderOpts {
                scripting_enabled: false,
                drop_doctype: true,
                ..Default::default()
            },
            ..Default::default()
        },
        QualName::new(None, ns!(html), local_name!("template")),
        Vec::new(),
        false,
    )
    .one(html);
    let mut changed = false;
    for image in document.select("img[src]").nodes() {
        let Some(source) = image.attr("src") else {
            continue;
        };
        if let Some(target) = aliases.get(&*source) {
            image.set_attr("src", target);
            changed = true;
        }
    }
    if changed {
        document
            .html_root()
            .try_inner_html()
            .map(|html| Some(html.to_string()))
            .ok_or_else(|| "Cannot serialize imported lesson HTML".into())
    } else {
        Ok(None)
    }
}
