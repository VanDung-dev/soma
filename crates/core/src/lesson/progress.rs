use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

const READING_DURATION_MS: u32 = 15_000;

#[derive(Serialize)]
#[serde(untagged)]
enum Position {
    Step(String),
    Complete,
}

#[derive(Default, Serialize)]
pub struct Progress {
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<Position>,
    read: Vec<String>,
    answers: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Action {
    Jump {
        step_id: Option<String>,
    },
    Finish,
    Read {
        step_id: String,
    },
    Answer {
        step_id: String,
        question_id: String,
        answer_id: String,
        choice_id: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    id: String,
    mode: Option<String>,
    question_ref: Option<String>,
    questions: Vec<Question>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Question {
    id: String,
    answer_id: String,
}

#[derive(Serialize)]
pub struct StepState {
    read: bool,
    locked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playback<'a> {
    index: usize,
    complete: bool,
    reading: bool,
    reading_duration_ms: u32,
    read: bool,
    awaiting_answers: bool,
    next_locked: bool,
    questions_only: bool,
    show_questions: bool,
    correct_questions: Vec<&'a str>,
    rows: Vec<StepState>,
}

impl Step {
    fn has_question_ref(&self) -> bool {
        self.question_ref.as_ref().is_some_and(|id| !id.is_empty())
    }

    fn questions(&self) -> &[Question] {
        if self.has_question_ref() || self.mode.as_deref() == Some("content") {
            &[]
        } else {
            &self.questions
        }
    }
}

fn answer_key(step_id: &str, question_id: &str) -> String {
    format!("{step_id}/{question_id}")
}

impl Progress {
    pub fn from_storage(data: Option<&str>) -> Self {
        let Some(saved) = data.and_then(|data| serde_json::from_str::<Value>(data).ok()) else {
            return Self::default();
        };
        Self {
            position: match saved.get("position") {
                Some(Value::String(id)) => Some(Position::Step(id.clone())),
                Some(Value::Null) => Some(Position::Complete),
                _ => None,
            },
            read: saved["read"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
            answers: saved["answers"]
                .as_object()
                .into_iter()
                .flatten()
                .filter_map(|(id, choice)| Some((id.clone(), choice.as_str()?.to_owned())))
                .collect(),
        }
    }

    pub fn preview(mut self, initial_step_id: Option<String>) -> Self {
        self.position = initial_step_id.map(Position::Step);
        self.answers.clear();
        self
    }

    pub fn update(mut self, stored: Option<Self>, action: Action) -> Option<Self> {
        if let Some(stored) = stored {
            let mut seen = HashSet::new();
            self.read = stored
                .read
                .into_iter()
                .chain(self.read)
                .filter(|id| seen.insert(id.clone()))
                .collect();
            self.answers.extend(stored.answers);
        }
        self.position = match action {
            Action::Jump { step_id } => step_id.map(Position::Step),
            Action::Finish => Some(Position::Complete),
            Action::Read { step_id } => {
                if !self.read.contains(&step_id) {
                    self.read.push(step_id.clone());
                }
                Some(Position::Step(step_id))
            }
            Action::Answer {
                step_id,
                question_id,
                answer_id,
                choice_id,
            } => {
                if answer_id != choice_id {
                    return None;
                }
                self.answers
                    .insert(answer_key(&step_id, &question_id), choice_id);
                Some(Position::Step(step_id))
            }
        };
        Some(self)
    }

    pub fn playback<'a>(
        &self,
        steps: &'a [Step],
        issues: &HashSet<String>,
        preview: bool,
    ) -> Playback<'a> {
        let read: HashSet<_> = self.read.iter().map(String::as_str).collect();
        let is_answered = |step: &Step, question: &Question| {
            self.answers.get(&answer_key(&step.id, &question.id)) == Some(&question.answer_id)
        };
        let awaiting = |step: &Step| {
            step.questions()
                .iter()
                .any(|question| !is_answered(step, question))
        };
        let boundary = if preview {
            None
        } else {
            steps.iter().position(|step| {
                issues.contains(&step.id) || !read.contains(step.id.as_str()) || awaiting(step)
            })
        };
        let complete = matches!(self.position.as_ref(), Some(Position::Complete))
            && boundary.is_none()
            && !steps.is_empty();
        let saved_index = match &self.position {
            Some(Position::Step(id)) => steps.iter().position(|step| step.id == *id),
            _ => None,
        };
        let resume = saved_index.unwrap_or_else(|| {
            if self.position.is_some() {
                boundary.unwrap_or(0)
            } else {
                0
            }
        });
        let index = if complete {
            steps.len() - 1
        } else {
            boundary.map_or(resume, |boundary| resume.min(boundary))
        };
        let current = steps.get(index);
        let current_read = !preview && current.is_some_and(|step| read.contains(step.id.as_str()));
        let can_study = !preview && current.is_some_and(|step| !issues.contains(&step.id));
        let locked = |index| boundary.is_some_and(|boundary| index > boundary);
        let questions = current.map_or(&[][..], Step::questions);
        Playback {
            index,
            complete,
            reading: can_study && !complete && !current_read,
            reading_duration_ms: READING_DURATION_MS,
            read: current_read,
            awaiting_answers: can_study && current.is_some_and(awaiting),
            next_locked: locked(index + 1),
            questions_only: current.is_some_and(|step| {
                !step.has_question_ref() && step.mode.as_deref() == Some("questions")
            }),
            show_questions: !questions.is_empty(),
            correct_questions: questions
                .iter()
                .filter(|question| current.is_some_and(|step| is_answered(step, question)))
                .map(|question| question.id.as_str())
                .collect(),
            rows: steps
                .iter()
                .enumerate()
                .map(|(index, step)| StepState {
                    read: read.contains(step.id.as_str()),
                    locked: locked(index),
                })
                .collect(),
        }
    }
}
