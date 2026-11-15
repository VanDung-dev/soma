use catalog::lesson::{self, ARCHIVE_LIMIT, IMAGE_LIMIT, JSON_LIMIT};
use content::lessons::{self, Files, Package, tar};
use std::io::Write;

fn draft() -> String {
    serde_json::json!({"id":"stable-lesson-id", "version":1, "title":{"vi":"Học giải phẫu", "en":""},
        "summary":{"vi":"", "en":""}, "modelId":"", "steps":[]}).to_string()
}

fn files() -> Files {
    Files::from([
        (
            "manifest.json".into(),
            br#"{"format":"soma-lesson","version":1}"#.to_vec(),
        ),
        ("lesson.json".into(), draft().into_bytes()),
    ])
}

fn checksum(bytes: &mut [u8]) {
    bytes[148..156].fill(32);
    let sum: usize = bytes.iter().map(|byte| usize::from(*byte)).sum();
    bytes[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
}

#[test]
fn tar_preserves_bytes_and_rejects_unsafe_entries_and_broken_endings() {
    let files = files();
    let bytes = tar::pack(&files).unwrap();
    assert_eq!(tar::unpack(&bytes).unwrap(), files);
    for path in [
        "../lesson.json",
        "/lesson.json",
        "images/../../evil",
        "unknown.txt",
    ] {
        let mut files = files.clone();
        files.insert(path.into(), vec![1]);
        assert!(tar::pack(&files).is_err());
    }
    let mut corrupt = bytes.clone();
    corrupt[20] ^= 1;
    assert!(tar::unpack(&corrupt).is_err());
    let mut link = bytes.clone();
    link[156] = b'2';
    checksum(&mut link[..512]);
    assert!(tar::unpack(&link).is_err());
    let mut duplicate = bytes.clone();
    duplicate[1024..1124].fill(0);
    duplicate[1024..1035].copy_from_slice(b"lesson.json");
    checksum(&mut duplicate[1024..1536]);
    assert!(tar::unpack(&duplicate).is_err());
    let mut trailing = bytes.clone();
    *trailing.last_mut().unwrap() = 1;
    assert!(tar::unpack(&trailing).is_err());
    assert!(tar::unpack(&bytes[..bytes.len() - 512]).is_err());
    assert!(tar::unpack(&bytes[..bytes.len() - 1]).is_err());
}

#[test]
fn tar_and_brotli_enforce_bounds_before_unbounded_expansion() {
    assert!(tar::pack(&Files::new()).is_err());
    let mut files = files();
    files.insert("lesson.json".into(), vec![0; JSON_LIMIT + 1]);
    assert!(tar::pack(&files).is_err());
    files.insert("lesson.json".into(), draft().into_bytes());
    files.insert(
        format!("images/{}.png", "a".repeat(64)),
        vec![0; IMAGE_LIMIT + 1],
    );
    assert!(tar::pack(&files).is_err());
    let bytes = vec![0; ARCHIVE_LIMIT + 1];
    assert!(lessons::compress(&bytes).is_err());
    let mut compressed = Vec::new();
    {
        let mut encoder = brotli::CompressorWriter::new(&mut compressed, 4096, 0, 22);
        encoder.write_all(&bytes).unwrap();
    }
    assert!(lessons::decompress(&compressed).is_err());
    assert!(lessons::decompress(b"not brotli").is_err());
}

#[test]
fn package_round_trip_preserves_identity_and_old_soma_packages_and_rejects_json() {
    let pack = Package::new(&draft()).unwrap();
    let bytes = pack.export().unwrap();
    for name in ["Renamed.lesson.br", "legacy.soma.br"] {
        let opened = Package::open(name, &bytes).unwrap();
        assert_eq!(opened.lesson, pack.lesson);
    }
    assert!(Package::open("draft.json", draft().as_bytes()).is_err());
    assert!(Package::open("draft.JSON", &bytes).is_err());
    assert!(Package::open("raw.lesson.br", draft().as_bytes()).is_err());
    let mut files = tar::unpack(&lessons::decompress(&bytes).unwrap()).unwrap();
    files.insert(
        "manifest.json".into(),
        br#"{"format":"soma","version":1}"#.to_vec(),
    );
    assert!(
        Package::open(
            "old.soma.br",
            &lessons::compress(&tar::pack(&files).unwrap()).unwrap()
        )
        .is_ok()
    );
    assert!(Package::open("wrong.game.br", &bytes).is_err());
    assert_eq!(
        lesson::filename(&pack.lesson, "vi"),
        "Học giải phẫu.lesson.br"
    );
}

#[test]
fn images_are_decoded_hashed_and_bounded_in_rust() {
    let png = include_bytes!("../../../apps/web/public/home/anatomy.png");
    let image = lessons::image_info(png).unwrap();
    assert_eq!(image.mime, "image/png");
    assert_eq!((image.width, image.height), (640, 640));
    assert_eq!(
        image.path,
        "images/fcae271e76170fe19550dc70c167cf0d73e7da8f67729c346d2a728ef4440376.png"
    );
    assert!(lessons::image_info(b"<svg/>").is_err());
    assert!(lessons::image_info(&png[..24]).is_err());
    assert!(lessons::check_image_size(IMAGE_LIMIT + 1).is_err());
    let mut corrupted = png.to_vec();
    corrupted[16..20].copy_from_slice(&100_000u32.to_be_bytes());
    assert!(lessons::image_info(&corrupted).is_err());
    assert!(lessons::check_image_collection(&vec![(image.path, 1); 129]).is_err());
}
