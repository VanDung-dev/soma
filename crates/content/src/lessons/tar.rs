use super::Files;
use catalog::lesson::{self, ARCHIVE_LIMIT, IMAGE_COUNT_LIMIT, IMAGE_LIMIT, JSON_LIMIT};

fn block(size: usize) -> usize {
    size.div_ceil(512) * 512
}
fn valid_path(path: &str) -> bool {
    matches!(path, "manifest.json" | "lesson.json") || lesson::image_path(path)
}

fn validate(files: &Files) -> Result<usize, String> {
    if !files.contains_key("manifest.json")
        || !files.contains_key("lesson.json")
        || files.len() > IMAGE_COUNT_LIMIT + 2
    {
        return Err("Invalid lesson entries".into());
    }
    let mut size = 1024;
    for (path, bytes) in files {
        if !valid_path(path)
            || bytes.is_empty()
            || bytes.len()
                > if lesson::image_path(path) {
                    IMAGE_LIMIT
                } else {
                    JSON_LIMIT
                }
        {
            return Err("Invalid lesson entry".into());
        }
        size += 512 + block(bytes.len());
    }
    if size > ARCHIVE_LIMIT {
        return Err("Expanded lesson exceeds 64 MiB".into());
    }
    Ok(size)
}

fn put(header: &mut [u8], at: usize, value: &str) {
    header[at..at + value.len()].copy_from_slice(value.as_bytes());
}

pub fn pack(files: &Files) -> Result<Vec<u8>, String> {
    let mut output = vec![0; validate(files)?];
    let mut offset = 0;
    for (path, bytes) in files {
        let header = &mut output[offset..offset + 512];
        put(header, 0, path);
        put(header, 100, "0000644\0");
        put(header, 108, "0000000\0");
        put(header, 116, "0000000\0");
        put(header, 124, &format!("{:011o}\0", bytes.len()));
        put(header, 136, "00000000000\0");
        header[148..156].fill(32);
        put(header, 156, "0");
        put(header, 257, "ustar\0");
        put(header, 263, "00");
        let checksum: usize = header.iter().map(|byte| usize::from(*byte)).sum();
        put(header, 148, &format!("{checksum:06o}\0 "));
        output[offset + 512..offset + 512 + bytes.len()].copy_from_slice(bytes);
        offset += 512 + block(bytes.len());
    }
    Ok(output)
}

fn field(header: &[u8], start: usize, length: usize) -> Result<&str, String> {
    std::str::from_utf8(
        header[start..start + length]
            .split(|byte| *byte == 0)
            .next()
            .unwrap_or_default(),
    )
    .map_err(|cause| cause.to_string())
}

fn octal(header: &[u8], start: usize, length: usize) -> Result<usize, String> {
    let text = field(header, start, length)?.trim();
    if text.is_empty() || !text.bytes().all(|byte| (b'0'..=b'7').contains(&byte)) {
        return Err("Invalid TAR number".into());
    }
    usize::from_str_radix(text, 8).map_err(|cause| cause.to_string())
}

pub fn unpack(bytes: &[u8]) -> Result<Files, String> {
    if bytes.len() > ARCHIVE_LIMIT || bytes.len() < 2048 || !bytes.len().is_multiple_of(512) {
        return Err("Invalid lesson TAR size".into());
    }
    let mut files = Files::new();
    let mut offset = 0;
    while offset + 1024 <= bytes.len() {
        let header = &bytes[offset..offset + 512];
        if header.iter().all(|byte| *byte == 0) {
            if bytes[offset..].iter().any(|byte| *byte != 0) {
                return Err("Invalid TAR ending".into());
            }
            validate(&files)?;
            return Ok(files);
        }
        let path = field(header, 0, 100)?;
        let size = octal(header, 124, 12)?;
        let checksum: usize = header
            .iter()
            .enumerate()
            .map(|(index, byte)| {
                if (148..156).contains(&index) {
                    32
                } else {
                    usize::from(*byte)
                }
            })
            .sum();
        if octal(header, 148, 8)? != checksum
            || field(header, 257, 6)? != "ustar"
            || field(header, 263, 2)? != "00"
            || header[156] != b'0'
            || !field(header, 157, 100)?.is_empty()
            || !field(header, 345, 155)?.is_empty()
            || !valid_path(path)
            || files.contains_key(path)
            || size == 0
            || size
                > if lesson::image_path(path) {
                    IMAGE_LIMIT
                } else {
                    JSON_LIMIT
                }
            || files.len() >= IMAGE_COUNT_LIMIT + 2
            || offset + 512 + block(size) + 1024 > bytes.len()
        {
            return Err("Invalid lesson TAR entry".into());
        }
        files.insert(
            path.to_owned(),
            bytes[offset + 512..offset + 512 + size].to_vec(),
        );
        offset += 512 + block(size);
    }
    Err("Missing TAR ending".into())
}
