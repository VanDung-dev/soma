use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::Path,
};

pub(super) fn read_file(path: &Path, limit: usize) -> io::Result<Vec<u8>> {
    if !fs::symlink_metadata(path)?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Expected a regular data file",
        ));
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Data file exceeds its size limit",
        ));
    }
    Ok(bytes)
}

pub(super) fn write_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().expect("Data file has a parent directory");
    fs::create_dir_all(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    Ok(())
}
