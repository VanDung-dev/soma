use catalog::lesson::{self, ARCHIVE_LIMIT, IMAGE_COUNT_LIMIT, IMAGE_LIMIT, JSON_LIMIT};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read, Write};

mod draft;
mod import;
mod questions;
mod scenes;
mod tables;
pub mod tar;
pub use draft::{DraftFiles, prepare_draft};
pub use import::{image_aliases, imported_image_additions, prepare_image_import};
use scenes::{externalize_lesson_scenes, hydrate_lesson_scenes};

pub type Files = BTreeMap<String, Vec<u8>>;

pub const LESSON_TABLE_FILES: [&str; 2] = [tables::SCENES.path, tables::QUESTIONS.path];
pub const DRAFT_TABLE_LIMIT: usize = 2 * ARCHIVE_LIMIT;
const ARCHIVE_VERSION: u64 = 1;

pub fn lesson_table_paths(lesson: &Value) -> impl Iterator<Item = &'static str> + '_ {
    [tables::SCENES, tables::QUESTIONS]
        .into_iter()
        .filter(move |table| table.is_referenced(lesson))
        .map(|table| table.path)
}

pub fn externalize_lesson_tables(
    lesson: &mut Value,
    previous: Option<&mut Value>,
) -> Result<(Files, Files), String> {
    let mut sections = externalize_lesson_sections(lesson)?;
    let mut retained = Files::new();
    if let Some(previous) = previous {
        let mut older = externalize_lesson_sections(previous)?;
        older.retain(|path, _| !sections.contains_key(path));
        tables::SCENES.pack_draft(previous, &mut older, &mut retained)?;
        tables::QUESTIONS.pack_draft(previous, &mut older, &mut retained)?;
    }
    let mut current = Files::new();
    tables::SCENES.pack_draft(lesson, &mut sections, &mut current)?;
    tables::QUESTIONS.pack_draft(lesson, &mut sections, &mut current)?;
    Ok((current, retained))
}

pub fn hydrate_lesson_tables(lesson: &mut Value, files: Files) -> Result<Vec<String>, String> {
    let bytes = |name| files.get(name).map(Vec::as_slice).unwrap_or_default();
    let scenes = tables::SCENES.unpack_draft(lesson, bytes(tables::SCENES.path))?;
    let questions = tables::QUESTIONS.unpack_draft(lesson, bytes(tables::QUESTIONS.path))?;
    let mut missing = hydrate_lesson_scenes(lesson, scenes);
    missing.extend(questions::hydrate_lesson_questions(lesson, questions));
    Ok(missing)
}

fn externalize_lesson_sections(lesson: &mut Value) -> Result<Files, String> {
    let mut files = questions::externalize_lesson_questions(lesson)?;
    files.extend(externalize_lesson_scenes(lesson)?);
    Ok(files)
}

pub const CONTENT_LIMIT: usize = JSON_LIMIT;
pub const CONTENT_COUNT_LIMIT: usize = 2048;

fn content_path(hash: &str) -> String {
    format!("content/{hash}.html")
}

fn content_hash(path: &str) -> Option<&str> {
    path.strip_prefix("content/")?
        .strip_suffix(".html")
        .filter(|hash| {
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
}

fn content_reference(value: &str) -> Option<&str> {
    value.strip_prefix("lesson-content:").filter(|hash| {
        hash.len() == 64
            && hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn transform_content(
    value: &mut Value,
    contents: &mut Files,
    externalize: bool,
    recover_missing: bool,
    missing: &mut Vec<String>,
) -> Result<(), String> {
    match value {
        Value::Object(fields) => {
            let locales: Vec<String> = fields
                .get("html")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            for locale in locales {
                let Some(Value::String(text)) = fields.get_mut(&locale) else {
                    continue;
                };
                if externalize {
                    if !text.is_empty() {
                        let hash = format!("{:x}", Sha256::digest(text.as_bytes()));
                        let path = content_path(&hash);
                        contents.insert(path, text.as_bytes().to_vec());
                        *text = format!("lesson-content:{hash}");
                    }
                } else if let Some(hash) = content_reference(text) {
                    let path = content_path(hash);
                    let Some(bytes) = contents.get(&path) else {
                        if recover_missing {
                            missing.push(path);
                            *text = "[Missing lesson text content]".into();
                            continue;
                        }
                        return Err("Missing lesson text content".into());
                    };
                    if format!("{:x}", Sha256::digest(bytes)) != hash {
                        if recover_missing {
                            missing.push(path);
                            *text = "[Missing lesson text content]".into();
                            continue;
                        }
                        return Err("Lesson text content does not match its reference".into());
                    }
                    match String::from_utf8(bytes.clone()) {
                        Ok(html) => *text = html,
                        Err(_) if recover_missing => {
                            missing.push(path);
                            *text = "[Missing lesson text content]".into();
                        }
                        Err(cause) => return Err(cause.to_string()),
                    }
                } else if text.starts_with("lesson-content:") {
                    if recover_missing {
                        missing.push(text.clone());
                        *text = "[Missing lesson text content]".into();
                    } else {
                        return Err("Invalid lesson text content reference".into());
                    }
                }
            }
            for child in fields.values_mut() {
                transform_content(child, contents, externalize, recover_missing, missing)?;
            }
        }
        Value::Array(items) => {
            for child in items {
                transform_content(child, contents, externalize, recover_missing, missing)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn externalize_lesson_content(lesson: &mut Value) -> Result<Files, String> {
    let mut contents = Files::new();
    transform_content(lesson, &mut contents, true, false, &mut Vec::new())?;
    if contents.len() > CONTENT_COUNT_LIMIT
        || contents
            .values()
            .try_fold(0usize, |total, bytes| {
                if bytes.len() > CONTENT_LIMIT {
                    return None;
                }
                total.checked_add(bytes.len())
            })
            .is_none_or(|total| total > ARCHIVE_LIMIT - 4 * 1024 * 1024)
    {
        return Err("Lesson text content limit exceeded".into());
    }
    Ok(contents)
}

pub fn hydrate_lesson_content(lesson: &mut Value, mut contents: Files) -> Result<(), String> {
    let references = lesson_content_paths(lesson);
    if references.len() != contents.len()
        || references.iter().any(|path| !contents.contains_key(path))
    {
        return Err("Invalid lesson text content entries".into());
    }
    transform_content(lesson, &mut contents, false, false, &mut Vec::new())?;
    if contents.len() > CONTENT_COUNT_LIMIT {
        return Err("Invalid lesson text content entries".into());
    }
    Ok(())
}

pub fn hydrate_lesson_content_recovering(lesson: &mut Value, mut contents: Files) -> Vec<String> {
    let mut missing = Vec::new();
    if let Err(error) = transform_content(lesson, &mut contents, false, true, &mut missing) {
        missing.push(error);
    }
    missing
}

pub fn lesson_content_paths(lesson: &Value) -> BTreeSet<String> {
    fn collect(value: &Value, paths: &mut BTreeSet<String>) {
        match value {
            Value::Object(fields) => {
                let locales = fields
                    .get("html")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str);
                for locale in locales {
                    if let Some(hash) = fields
                        .get(locale)
                        .and_then(Value::as_str)
                        .and_then(content_reference)
                    {
                        paths.insert(content_path(hash));
                    }
                }
                for child in fields.values() {
                    collect(child, paths);
                }
            }
            Value::Array(items) => items.iter().for_each(|child| collect(child, paths)),
            _ => {}
        }
    }

    let mut paths = BTreeSet::new();
    collect(lesson, &mut paths);
    paths
}

pub fn is_content_path(path: &str) -> bool {
    content_hash(path).is_some()
}

pub fn check_file(name: &str, size: usize) -> Result<(), String> {
    let name = name.to_lowercase();
    if !name.ends_with(".lesson.br") {
        return Err("Invalid .lesson.br file".into());
    } else if size > ARCHIVE_LIMIT {
        return Err("Lesson archive exceeds 64 MiB".into());
    }
    Ok(())
}

pub fn check_image_size(size: usize) -> Result<(), String> {
    if size == 0 || size > IMAGE_LIMIT {
        return Err("Image must be at most 10 MiB".into());
    }
    Ok(())
}

#[derive(Serialize)]
pub struct ImageInfo {
    pub path: String,
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
}

fn decode_image(
    bytes: &[u8],
) -> Result<(image::ImageFormat, u32, u32, image::DynamicImage), String> {
    check_image_size(bytes.len())?;
    let format = image::guess_format(bytes).map_err(|_| "Choose a PNG, JPEG or WebP image")?;
    match format {
        image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP => {}
        _ => return Err("Choose a PNG, JPEG or WebP image".into()),
    }
    if format == image::ImageFormat::WebP
        && bytes.get(12..16) == Some(b"VP8X")
        && bytes.get(20).is_some_and(|flags| flags & 2 != 0)
    {
        return Err("Animated images are not supported".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(ARCHIVE_LIMIT as u64);
    let reader = || {
        let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
        reader.limits(limits.clone());
        reader
    };
    let (width, height) = reader()
        .into_dimensions()
        .map_err(|cause| cause.to_string())?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 16 * 1024 * 1024 {
        return Err("Image exceeds 16 megapixels or is invalid".into());
    }
    let decoded = reader().decode().map_err(|cause| cause.to_string())?;
    Ok((format, width, height, decoded))
}

pub fn image_info(bytes: &[u8]) -> Result<ImageInfo, String> {
    let (format, width, height, _) = decode_image(bytes)?;
    let (extension, mime) = match format {
        image::ImageFormat::Png => ("png", "image/png"),
        image::ImageFormat::Jpeg => ("jpg", "image/jpeg"),
        image::ImageFormat::WebP => ("webp", "image/webp"),
        _ => return Err("Choose a PNG, JPEG or WebP image".into()),
    };
    let hash = format!("{:x}", Sha256::digest(bytes));
    Ok(ImageInfo {
        path: format!("images/{hash}.{extension}"),
        mime,
        width,
        height,
    })
}

pub fn image_fingerprint(bytes: &[u8]) -> Result<String, String> {
    let (_, width, height, decoded) = decode_image(bytes)?;
    let pixels = decoded.to_rgba8();
    let mut hash = Sha256::new();
    hash.update(width.to_be_bytes());
    hash.update(height.to_be_bytes());
    hash.update(pixels.as_raw());
    Ok(format!("{:x}", hash.finalize()))
}

pub fn check_image_collection(entries: &[(String, usize)]) -> Result<(), String> {
    if entries.len() > IMAGE_COUNT_LIMIT
        || entries
            .iter()
            .try_fold(0usize, |sum, (path, size)| {
                if !lesson::image_path(path) || *size == 0 || *size > IMAGE_LIMIT {
                    return None;
                }
                sum.checked_add(*size)
            })
            .is_none_or(|total| total > ARCHIVE_LIMIT - 4 * 1024 * 1024)
    {
        return Err("Lesson image limit exceeded".into());
    }
    Ok(())
}

pub fn compress(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() > ARCHIVE_LIMIT {
        return Err("Lesson archive exceeds 64 MiB".into());
    }
    let mut output = Vec::new();
    {
        let mut writer = brotli::CompressorWriter::new(&mut output, 4096, 5, 22);
        writer.write_all(bytes).map_err(|cause| cause.to_string())?;
    }
    if output.len() > ARCHIVE_LIMIT {
        return Err("Lesson archive exceeds 64 MiB".into());
    }
    Ok(output)
}

pub fn decompress(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() > ARCHIVE_LIMIT {
        return Err("Lesson archive exceeds 64 MiB".into());
    }
    let mut output = Vec::new();
    brotli::Decompressor::new(bytes, 4096)
        .take(ARCHIVE_LIMIT as u64 + 1)
        .read_to_end(&mut output)
        .map_err(|cause| cause.to_string())?;
    if output.len() > ARCHIVE_LIMIT {
        return Err("Expanded lesson exceeds 64 MiB".into());
    }
    Ok(output)
}

pub struct Package {
    pub lesson: Value,
    pub images: Files,
    pub preload_model_ids: Option<Vec<String>>,
}

impl Package {
    pub fn new(json: &str) -> Result<Self, String> {
        Ok(Self {
            lesson: lesson::parse(json, true).map_err(|cause| cause.to_string())?,
            images: Files::new(),
            preload_model_ids: None,
        })
    }

    pub fn open(name: &str, bytes: &[u8]) -> Result<Self, String> {
        check_file(name, bytes.len())?;
        let mut files = tar::unpack(&decompress(bytes)?)?;
        let manifest: Value = serde_json::from_slice(
            files
                .get("manifest.json")
                .ok_or("Missing lesson manifest")?,
        )
        .map_err(|cause| cause.to_string())?;
        if manifest["version"].as_u64() != Some(ARCHIVE_VERSION)
            || manifest["format"] != "soma-lesson"
        {
            return Err("Unsupported lesson archive format".into());
        }
        let json = files.remove("lesson.json").ok_or("Missing lesson JSON")?;
        files.remove("manifest.json");
        let mut lesson: Value = serde_json::from_slice(&json).map_err(|cause| cause.to_string())?;
        let scene_file = files.remove(tables::SCENES.path);
        let question_file = files.remove(tables::QUESTIONS.path);
        let preload: Vec<String> = serde_json::from_value(
            lesson
                .as_object_mut()
                .and_then(|root| root.remove("preloadModelIds"))
                .ok_or("Missing lesson model preload list")?,
        )
        .map_err(|cause| cause.to_string())?;
        let scenes = tables::SCENES.unpack(&lesson, scene_file.as_deref().unwrap_or_default())?;
        let missing = hydrate_lesson_scenes(&mut lesson, scenes);
        scenes::check_models(&scenes::declared_models(&lesson), &preload)?;
        let content_paths: Vec<_> = files
            .keys()
            .filter(|path| content_hash(path).is_some())
            .cloned()
            .collect();
        let mut contents = Files::new();
        for path in content_paths {
            contents.insert(path.clone(), files.remove(&path).unwrap());
        }
        hydrate_lesson_content(&mut lesson, contents)?;
        let questions =
            tables::QUESTIONS.unpack(&lesson, question_file.as_deref().unwrap_or_default())?;
        questions::hydrate_lesson_questions(&mut lesson, questions);
        let json = serde_json::to_string(&lesson).map_err(|cause| cause.to_string())?;
        let mut package = Self::new(&json)?;
        package.preload_model_ids = missing.is_empty().then_some(preload);
        for (path, bytes) in files {
            let image = image_info(&bytes)?;
            if image.path != path {
                return Err("Lesson image hash or format does not match its path".into());
            }
            package.images.insert(path, bytes);
        }
        package.check_resources()?;
        Ok(package)
    }

    pub fn add_image(&mut self, path: String, bytes: Vec<u8>) -> Result<(), String> {
        if !lesson::image_path(&path) || bytes.is_empty() || bytes.len() > IMAGE_LIMIT {
            return Err("Invalid lesson image".into());
        }
        self.images.insert(path, bytes);
        check_image_collection(
            &self
                .images
                .iter()
                .map(|(path, bytes)| (path.clone(), bytes.len()))
                .collect::<Vec<_>>(),
        )
    }

    pub fn check_resources(&self) -> Result<(), String> {
        check_image_collection(
            &self
                .images
                .iter()
                .map(|(path, bytes)| (path.clone(), bytes.len()))
                .collect::<Vec<_>>(),
        )?;
        lesson::validate_resources(&self.lesson, &self.images.keys().cloned().collect())
    }

    pub fn export(&self) -> Result<Vec<u8>, String> {
        self.export_with_models(None)
    }

    pub(crate) fn export_with_models(
        &self,
        model_ids: Option<Vec<String>>,
    ) -> Result<Vec<u8>, String> {
        lesson::validate(&self.lesson, true).map_err(|cause| cause.to_string())?;
        self.check_resources()?;
        let mut lesson_data = self.lesson.clone();
        let mut section_files = questions::externalize_lesson_questions(&mut lesson_data)?;
        let contents = externalize_lesson_content(&mut lesson_data)?;
        let declared = scenes::declared_models(&lesson_data);
        let preload = model_ids
            .or_else(|| self.preload_model_ids.clone())
            .unwrap_or_else(|| declared.clone());
        scenes::check_models(&declared, &preload)?;
        lesson_data["preloadModelIds"] =
            serde_json::to_value(preload).map_err(|cause| cause.to_string())?;
        section_files.extend(externalize_lesson_scenes(&mut lesson_data)?);
        let mut files = Files::from([(
            "manifest.json".into(),
            serde_json::to_vec(
                &serde_json::json!({"format":"soma-lesson","version":ARCHIVE_VERSION}),
            )
            .map_err(|cause| cause.to_string())?,
        )]);
        tables::SCENES.pack(&lesson_data, &mut section_files, &mut files)?;
        tables::QUESTIONS.pack(&lesson_data, &mut section_files, &mut files)?;
        files.insert(
            "lesson.json".into(),
            serde_json::to_vec_pretty(&lesson_data).map_err(|cause| cause.to_string())?,
        );
        files.extend(contents);
        for path in lesson::image_paths(&self.lesson) {
            let bytes = self.images.get(&path).ok_or("Missing lesson image")?;
            if image_info(bytes)?.path != path {
                return Err("Lesson image hash or format does not match its path".into());
            }
            files.insert(path, bytes.clone());
        }
        compress(&tar::pack(&files)?)
    }
}
