use html5ever::tokenizer::{BufferQueue, StartTag, Token, TokenSink, TokenSinkResult, Tokenizer};
use serde::Serialize;
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::collections::{BTreeSet, HashMap, HashSet};

pub mod draft;
pub mod editing;

pub const ARCHIVE_LIMIT: usize = 64 * 1024 * 1024;
pub const JSON_LIMIT: usize = 2 * 1024 * 1024;
pub const LESSON_LIMIT: usize = ARCHIVE_LIMIT;
pub const IMAGE_LIMIT: usize = 10 * 1024 * 1024;
pub const IMAGE_COUNT_LIMIT: usize = 128;

#[derive(Debug, Clone, Serialize)]
pub struct ValidationError {
    pub reason: &'static str,
    pub step: usize,
    pub message: String,
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

fn error(reason: &'static str, step: usize, message: impl Into<String>) -> ValidationError {
    ValidationError {
        reason,
        step,
        message: message.into(),
    }
}

pub fn image_path(path: &str) -> bool {
    path.strip_prefix("images/")
        .and_then(|name| name.split_once('.'))
        .is_some_and(|(hash, ext)| {
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                && matches!(ext, "png" | "jpg" | "webp")
        })
}

#[derive(Default)]
struct HtmlContent {
    text: RefCell<String>,
    images: RefCell<BTreeSet<String>>,
    has_media: Cell<bool>,
    inside_media: Cell<bool>,
}

impl TokenSink for HtmlContent {
    type Handle = ();
    fn process_token(&self, token: Token, _: u64) -> TokenSinkResult<()> {
        match token {
            Token::CharacterTokens(text) => self.text.borrow_mut().push_str(&text),
            Token::TagToken(tag) => {
                let name = tag.name.as_ref();
                if matches!(name, "video" | "audio") {
                    self.inside_media.set(tag.kind == StartTag);
                }
                if tag.kind == StartTag
                    && let Some(src) = tag
                        .attrs
                        .iter()
                        .find(|attr| attr.name.local.as_ref() == "src")
                {
                    match name {
                        "img" if image_path(&src.value) => {
                            self.images.borrow_mut().insert(src.value.to_string());
                        }
                        "video" | "audio" | "source"
                            if self.inside_media.get() && src.value.starts_with("https://") =>
                        {
                            self.has_media.set(true);
                        }
                        "iframe"
                            if [
                                "https://www.youtube.com/embed/",
                                "https://www.youtube-nocookie.com/embed/",
                                "https://player.vimeo.com/video/",
                            ]
                            .iter()
                            .any(|prefix| src.value.starts_with(prefix)) =>
                        {
                            self.has_media.set(true);
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
        TokenSinkResult::Continue
    }
}

fn html_content(html: &str) -> HtmlContent {
    let input = BufferQueue::default();
    input.push_back(html.into());
    let tokenizer = Tokenizer::new(HtmlContent::default(), Default::default());
    let _ = tokenizer.feed(&input);
    tokenizer.end();
    tokenizer.sink
}

fn slug(value: &Value) -> bool {
    value.as_str().is_some_and(|text| {
        !text.is_empty()
            && text.split('-').all(|part| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            })
    })
}

fn localized(value: &Value, required: bool) -> bool {
    if !value.is_object() || !value["vi"].is_string() || !value["en"].is_string() {
        return false;
    }
    let locales = match value.get("html") {
        None => Vec::new(),
        Some(Value::Array(locales))
            if locales
                .iter()
                .all(|locale| matches!(locale.as_str(), Some("vi" | "en")))
                && locales.iter().collect::<HashSet<_>>().len() == locales.len() =>
        {
            locales.iter().filter_map(Value::as_str).collect()
        }
        _ => return false,
    };
    !required
        || ["vi", "en"].iter().any(|locale| {
            let text = value[locale].as_str().unwrap_or_default();
            if locales.contains(locale) {
                let content = html_content(text);
                !content.text.borrow().trim().is_empty()
                    || !content.images.borrow().is_empty()
                    || content.has_media.get()
            } else {
                !text.trim().is_empty()
            }
        })
}

fn finite(value: &Value, max: f64) -> bool {
    value
        .as_f64()
        .is_some_and(|number| number.is_finite() && number.abs() <= max)
}

fn vector(value: &Value, length: usize, max: f64) -> bool {
    value
        .as_array()
        .is_some_and(|items| items.len() == length && items.iter().all(|item| finite(item, max)))
}

fn view(value: &Value) -> bool {
    value.as_object().is_some_and(|fields| {
        fields
            .keys()
            .all(|key| matches!(key.as_str(), "camera" | "explosion"))
    }) && value["camera"].as_object().is_some_and(|camera| {
        camera.keys().all(|key| {
            matches!(
                key.as_str(),
                "target" | "yaw" | "pitch" | "distance" | "pan"
            )
        })
    }) && finite(&value["explosion"], 100.)
        && value["explosion"].as_f64().unwrap_or(-1.) >= 0.
        && vector(&value["camera"]["target"], 3, 1e12)
        && vector(&value["camera"]["pan"], 2, 1e6)
        && finite(&value["camera"]["yaw"], std::f32::consts::TAU as f64)
        && finite(
            &value["camera"]["pitch"],
            std::f32::consts::FRAC_PI_2 as f64,
        )
        && finite(&value["camera"]["distance"], 1e12)
        && value["camera"]["distance"]
            .as_f64()
            .is_some_and(|distance| distance as f32 > 0.)
}

fn strings(value: &Value) -> bool {
    value.as_array().is_some_and(|items| {
        items.iter().all(Value::is_string)
            && items.iter().collect::<HashSet<_>>().len() == items.len()
    })
}

pub fn scene(value: &Value) -> bool {
    value["targetId"].is_string()
        && value.get("modelIds").is_none_or(strings)
        && value.get("view").is_none_or(view)
        && value.get("visibleIds").is_none_or(strings)
}

pub fn section_reference(reference: &str) -> bool {
    reference.len() == 64
        && reference
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn has_scene_ref(value: &Value) -> bool {
    value["sceneRef"].as_str().is_some_and(section_reference)
}

fn has_question_ref(value: &Value) -> bool {
    value["questionRef"].as_str().is_some_and(section_reference)
}

fn questions_enabled(step: &Value) -> bool {
    step["mode"] != "content"
        && (step["mode"] == "questions"
            || step["mode"] == "content_questions"
            || step["questions"]
                .as_array()
                .is_some_and(|questions| !questions.is_empty()))
}

pub fn questions(value: &Value, required: bool) -> bool {
    let Some(questions) = value.as_array() else {
        return false;
    };
    let mut ids = HashSet::new();
    (!required || !questions.is_empty())
        && questions.iter().all(|question| {
            let mut choices = HashSet::new();
            slug(&question["id"])
                && ids.insert(question["id"].as_str().unwrap())
                && localized(&question["prompt"], required)
                && localized(&question["explanation"], false)
                && question["answerId"].is_string()
                && question["choices"].as_array().is_some_and(|items| {
                    (!required || items.len() >= 2)
                        && items.iter().all(|choice| {
                            choice["id"]
                                .as_str()
                                .is_some_and(|id| !id.is_empty() && choices.insert(id))
                                && localized(&choice["text"], required)
                        })
                        && (!required || choices.contains(question["answerId"].as_str().unwrap()))
                })
        })
}

pub fn validate(lesson: &Value, draft: bool) -> Result<(), ValidationError> {
    if !lesson.is_object()
        || !slug(&lesson["id"])
        || !lesson["version"]
            .as_u64()
            .is_some_and(|version| (1..=9_007_199_254_740_991).contains(&version))
        || ["createdAt", "updatedAt"].into_iter().any(|field| {
            lesson.get(field).is_some_and(|value| {
                value
                    .as_u64()
                    .is_none_or(|time| time > 8_640_000_000_000_000)
            })
        })
        || !localized(&lesson["title"], !draft)
        || !localized(&lesson["summary"], false)
        || lesson
            .get("author")
            .is_some_and(|author| !author.is_string())
        || lesson
            .get("cover")
            .is_some_and(|cover| !cover.as_str().is_some_and(image_path))
        || !lesson["modelId"].is_string()
        || lesson.get("modelIds").is_some_and(|value| !strings(value))
        || lesson
            .get("preloadModelIds")
            .is_some_and(|value| !strings(value))
        || lesson.get("scene").is_some_and(|value| !scene(value))
        || lesson.get("sceneRef").is_some() && !has_scene_ref(lesson)
        || !lesson["steps"].is_array()
        || !draft && lesson["steps"].as_array().is_none_or(Vec::is_empty)
    {
        return Err(error(
            "details",
            0,
            "A lesson needs a title and at least one step.",
        ));
    }
    let mut ids = HashSet::new();
    for (index, step) in lesson["steps"].as_array().unwrap().iter().enumerate() {
        let number = index + 1;
        if !step.is_object()
            || !slug(&step["id"])
            || !matches!(step["kind"].as_str(), Some("text" | "observe"))
            || !ids.insert(step["id"].as_str().unwrap())
            || !localized(&step["title"], !draft)
            || !localized(&step["instruction"], !draft && step["mode"] != "questions")
            || step.get("mode").is_some_and(|mode| {
                !matches!(
                    mode.as_str(),
                    Some("content" | "questions" | "content_questions")
                )
            })
            || step
                .get("showModel")
                .is_some_and(|value| !value.is_boolean())
            || step.get("sceneRef").is_some() && !has_scene_ref(step)
            || step.get("questionRef").is_some() && !has_question_ref(step)
        {
            return Err(error(
                "stepText",
                number,
                format!("Step {number} needs a title and instructions."),
            ));
        }
        if step
            .get("questions")
            .is_some_and(|value| !questions(value, !draft && questions_enabled(step)))
            || !draft
                && !has_question_ref(step)
                && questions_enabled(step)
                && step.get("questions").is_none()
        {
            return Err(error(
                "choices",
                number,
                format!("Step {number} needs complete questions, choices and correct answers."),
            ));
        }
        if step["kind"] != "text"
            && (!scene(step)
                || !draft
                    && !has_scene_ref(step)
                    && step["showModel"] != false
                    && (step["targetId"] == ""
                        || if let Some(models) = step.get("modelIds") {
                            models.as_array().is_none_or(Vec::is_empty)
                        } else {
                            lesson["modelId"] == ""
                                && lesson["modelIds"].as_array().is_none_or(Vec::is_empty)
                        }))
        {
            return Err(error(
                "target",
                number,
                format!("Step {number} needs a model and a structure."),
            ));
        }
    }
    Ok(())
}

pub fn parse(json: &str, draft: bool) -> Result<Value, ValidationError> {
    if json.len() > LESSON_LIMIT {
        return Err(error("details", 0, "Lesson data exceeds 64 MiB"));
    }
    let lesson =
        serde_json::from_str(json).map_err(|cause| error("details", 0, cause.to_string()))?;
    validate(&lesson, draft)?;
    Ok(lesson)
}

pub fn validate_targets(
    lesson: &Value,
    ids: &[String],
    members: &HashMap<String, Vec<String>>,
) -> Result<(), ValidationError> {
    let model: HashSet<_> = ids.iter().collect();
    let empty = Vec::new();
    for (index, step) in lesson["steps"].as_array().into_iter().flatten().enumerate() {
        if step["kind"] == "text" || step["showModel"] == false || has_scene_ref(step) {
            continue;
        }
        let target = members
            .get(step["targetId"].as_str().unwrap_or_default())
            .unwrap_or(&empty);
        let scene: Vec<_> = step["visibleIds"]
            .as_array()
            .map(|ids| {
                ids.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_else(|| target.clone());
        let assigned = step
            .get("modelIds")
            .and_then(Value::as_array)
            .map(|models| {
                models
                    .iter()
                    .filter_map(Value::as_str)
                    .flat_map(|id| members.get(id).unwrap_or(&empty))
                    .collect::<HashSet<_>>()
            });
        let available = assigned.as_ref().unwrap_or(&model);
        if target.is_empty()
            || !target.iter().all(|id| available.contains(id))
            || scene.is_empty()
            || !scene.iter().all(|id| available.contains(id))
        {
            return Err(error(
                "scope",
                index + 1,
                format!("Step {}: unavailable structure.", index + 1),
            ));
        }
    }
    Ok(())
}

pub fn preview_issues(
    lesson: &Value,
    ids: &[String],
    members: &HashMap<String, Vec<String>>,
) -> Vec<(String, ValidationError)> {
    let mut section = lesson.clone();
    lesson["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, step)| {
            section["steps"] = serde_json::json!([step]);
            let mut cause = validate(&section, false)
                .and_then(|()| validate_targets(&section, ids, members))
                .err()?;
            if cause.step != 0 {
                cause.step = index + 1;
            }
            Some((step["id"].as_str().unwrap_or_default().to_owned(), cause))
        })
        .collect()
}

pub fn scene_index(lesson: &Value, index: usize) -> Option<usize> {
    let steps = lesson["steps"].as_array()?;
    if steps
        .get(index)
        .is_some_and(|step| step["showModel"] == false || has_scene_ref(step))
    {
        return None;
    }
    let scene = |(_, step): &(usize, &Value)| step["kind"] != "text" && !has_scene_ref(step);
    steps
        .iter()
        .enumerate()
        .take(index.saturating_add(1))
        .rfind(scene)
        .map(|(index, _)| index)
        .or_else(|| steps.iter().enumerate().find(scene).map(|(index, _)| index))
}

pub fn image_paths(lesson: &Value) -> BTreeSet<String> {
    let mut texts = vec![&lesson["title"], &lesson["summary"]];
    for step in lesson["steps"].as_array().into_iter().flatten() {
        texts.extend([&step["title"], &step["instruction"]]);
        for question in step["questions"].as_array().into_iter().flatten() {
            texts.extend([&question["prompt"], &question["explanation"]]);
            for choice in question["choices"].as_array().into_iter().flatten() {
                texts.push(&choice["text"]);
            }
        }
    }
    let mut paths = BTreeSet::new();
    if let Some(cover) = lesson["cover"].as_str().filter(|path| image_path(path)) {
        paths.insert(cover.to_owned());
    }
    for text in texts {
        for locale in text["html"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            paths.extend(
                html_content(text[locale].as_str().unwrap_or_default())
                    .images
                    .into_inner(),
            );
        }
    }
    paths
}

pub fn validate_resources(lesson: &Value, paths: &HashSet<String>) -> Result<(), String> {
    for path in image_paths(lesson) {
        if !paths.contains(&path) {
            return Err(format!("Missing lesson image: {path}"));
        }
    }
    Ok(())
}

pub fn filename(lesson: &Value, language: &str) -> String {
    let primary = if language == "en" { "en" } else { "vi" };
    let secondary = if primary == "vi" { "en" } else { "vi" };
    let title = [primary, secondary]
        .into_iter()
        .filter_map(|locale| lesson["title"][locale].as_str())
        .map(str::trim)
        .find(|value| !value.is_empty())
        .unwrap_or(if primary == "vi" {
            "Bài học chưa đặt tên"
        } else {
            "Untitled lesson"
        });
    let mut name = String::new();
    for ch in title.chars() {
        let ch = if ch.is_control()
            || "<>:\"/\\|?*".contains(ch)
            || matches!(ch, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        {
            '-'
        } else {
            ch
        };
        if name.len() + ch.len_utf8() > 180 {
            break;
        }
        name.push(ch);
    }
    let mut name = name.trim_matches([' ', '.']).to_owned();
    if name.is_empty() {
        name = "Lesson".into();
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix)
                .is_some_and(|n| n.len() == 1 && matches!(n.as_bytes()[0], b'1'..=b'9'))
        })
    {
        name.insert(0, '_');
    }
    format!("{name}.lesson.br")
}
