use catalog::lesson::{self, ARCHIVE_LIMIT, IMAGE_COUNT_LIMIT, IMAGE_LIMIT, JSON_LIMIT};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};

pub mod tar;

pub type Files = BTreeMap<String, Vec<u8>>;

pub fn check_file(name: &str, size: usize) -> Result<(), String> {
    let name = name.to_lowercase();
    if name.ends_with(".json") {
        if size > JSON_LIMIT {
            return Err("Lesson JSON exceeds 2 MiB".into());
        }
    } else if !name.ends_with(".lesson.br") && !name.ends_with(".soma.br") {
        return Err("Invalid .lesson.br file".into());
    } else if size > ARCHIVE_LIMIT {
        return Err("Lesson archive exceeds 64 MiB".into());
    }
    Ok(())
}

pub fn check_image_size(size: usize) -> Result<(), String> {
    if size == 0 || size > IMAGE_LIMIT {
        return Err("Image must be at most 8 MiB".into());
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

pub fn image_info(bytes: &[u8]) -> Result<ImageInfo, String> {
    check_image_size(bytes.len())?;
    let format = image::guess_format(bytes).map_err(|_| "Choose a PNG, JPEG or WebP image")?;
    let (extension, mime) = match format {
        image::ImageFormat::Png => ("png", "image/png"),
        image::ImageFormat::Jpeg => ("jpg", "image/jpeg"),
        image::ImageFormat::WebP => ("webp", "image/webp"),
        _ => return Err("Choose a PNG, JPEG or WebP image".into()),
    };
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
    reader().decode().map_err(|cause| cause.to_string())?;
    let hash = format!("{:x}", Sha256::digest(bytes));
    Ok(ImageInfo {
        path: format!("images/{hash}.{extension}"),
        mime,
        width,
        height,
    })
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
}

impl Package {
    pub fn new(json: &str) -> Result<Self, String> {
        Ok(Self {
            lesson: lesson::parse(json, true).map_err(|cause| cause.to_string())?,
            images: Files::new(),
        })
    }

    pub fn open(name: &str, bytes: &[u8]) -> Result<Self, String> {
        check_file(name, bytes.len())?;
        let name = name.to_lowercase();
        if name.ends_with(".json") {
            if bytes.len() > JSON_LIMIT {
                return Err("Lesson JSON exceeds 2 MiB".into());
            }
            let package =
                Self::new(std::str::from_utf8(bytes).map_err(|cause| cause.to_string())?)?;
            package.check_resources()?;
            return Ok(package);
        }
        let mut files = tar::unpack(&decompress(bytes)?)?;
        let manifest: Value = serde_json::from_slice(
            files
                .get("manifest.json")
                .ok_or("Missing lesson manifest")?,
        )
        .map_err(|cause| cause.to_string())?;
        if manifest["version"] != 1
            || !matches!(manifest["format"].as_str(), Some("soma-lesson" | "soma"))
        {
            return Err("Unsupported lesson archive format".into());
        }
        let json = files.remove("lesson.json").ok_or("Missing lesson JSON")?;
        let mut package =
            Self::new(std::str::from_utf8(&json).map_err(|cause| cause.to_string())?)?;
        files.remove("manifest.json");
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
        lesson::validate(&self.lesson, true).map_err(|cause| cause.to_string())?;
        self.check_resources()?;
        let mut files = Files::from([
            (
                "manifest.json".into(),
                br#"{"format":"soma-lesson","version":1}"#.to_vec(),
            ),
            (
                "lesson.json".into(),
                serde_json::to_vec_pretty(&self.lesson).map_err(|cause| cause.to_string())?,
            ),
        ]);
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
