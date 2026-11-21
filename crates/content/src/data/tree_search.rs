use super::{CatalogData, SearchHit, normalize};
use icu_normalizer::ComposingNormalizer;
use icu_properties::{
    CodePointMapData,
    props::{GeneralCategory, GeneralCategoryGroup},
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeSearch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub best_id: Option<String>,
    pub folders: HashSet<String>,
    pub structures: HashMap<String, String>,
    pub initial_open: Vec<String>,
    pub limits: HashMap<String, usize>,
    pub highlights: HashMap<String, [usize; 2]>,
}

struct QueryWord {
    text: String,
    allow_fold: bool,
}

fn words(text: &str) -> Vec<(usize, &str)> {
    let categories = CodePointMapData::<GeneralCategory>::new();
    let mut result = Vec::new();
    let mut start = None;
    for (index, ch) in text.char_indices() {
        let category = categories.get(ch);
        if GeneralCategoryGroup::Letter.contains(category)
            || GeneralCategoryGroup::Mark.contains(category)
            || GeneralCategoryGroup::Number.contains(category)
        {
            start.get_or_insert(index);
        } else if let Some(start) = start.take() {
            result.push((start, &text[start..index]));
        }
    }
    if let Some(start) = start {
        result.push((start, &text[start..]));
    }
    result
}

fn label_match(label: &str, query: &[QueryWord]) -> Option<(usize, [usize; 2])> {
    let normalizer = ComposingNormalizer::new_nfc();
    let label = normalizer.normalize(label);
    let words = words(&label);
    let mut best = None;
    for phrase in words.windows(query.len()) {
        let mut folded = false;
        let mut prefix = false;
        let matches = phrase
            .iter()
            .zip(query)
            .enumerate()
            .all(|(index, ((_, text), word))| {
                let exact = text.to_lowercase();
                if exact == word.text {
                    return true;
                }
                let exact_prefix = exact.starts_with(word.text.as_str());
                let comparable = if word.allow_fold {
                    normalize(&exact)
                } else {
                    exact
                };
                if comparable == word.text {
                    folded = true;
                    return true;
                }
                prefix = index + 1 == query.len()
                    && (exact_prefix
                        || (word.text.encode_utf16().count() >= 3
                            && comparable.starts_with(word.text.as_str())));
                prefix
            });
        if !matches {
            continue;
        }
        let quality = if prefix {
            2
        } else {
            usize::from(phrase.len() != words.len())
        };
        let rank = quality * 2 + usize::from(folded);
        if best.is_some_and(|(best_rank, _)| best_rank <= rank) {
            continue;
        }
        let (last_start, last_word) = phrase[phrase.len() - 1];
        let end = if prefix {
            label[..last_start].encode_utf16().count()
                + query[query.len() - 1].text.encode_utf16().count()
        } else {
            label[..last_start + last_word.len()].encode_utf16().count()
        };
        best = Some((rank, [label[..phrase[0].0].encode_utf16().count(), end]));
    }
    best
}

impl CatalogData {
    pub fn search_tree(&self, query: &str, language: &str) -> Option<TreeSearch> {
        let normalizer = ComposingNormalizer::new_nfc();
        let lower = query.to_lowercase();
        let normalized = normalizer.normalize(&lower);
        let query_words: Vec<_> = words(&normalized)
            .into_iter()
            .map(|(_, word)| QueryWord {
                text: word.to_owned(),
                allow_fold: normalize(word) == word,
            })
            .collect();
        if query_words.is_empty() {
            return None;
        }

        let mut result = TreeSearch::default();
        let mut best_rank = usize::MAX;
        let english = language == "en";
        for hit in self.search_hits(query) {
            let (id, names, latin) = match hit {
                SearchHit::Structure(index) => {
                    let row = self.row(index);
                    (row.source_id, row.names, Some(row.latin))
                }
                SearchHit::Target(index) => {
                    let target = self.target_at(index);
                    (target.id, target.names, None)
                }
            };
            let mut labels = [names.vi.as_str(), names.en.as_str(), latin.unwrap_or("")];
            if english {
                labels.swap(0, 1);
            }
            let mut rank = usize::MAX;
            for (index, label) in labels.into_iter().enumerate() {
                if let Some((quality, range)) = label_match(label, &query_words) {
                    rank = rank.min(quality * labels.len() + index);
                    result.highlights.insert(label.to_owned(), range);
                }
            }
            if rank == usize::MAX {
                continue;
            }
            let path = self.reveal(id);
            let Some((direct_folder, _)) = path.first() else {
                continue;
            };
            if latin.is_some() {
                result
                    .structures
                    .insert(id.to_owned(), direct_folder.clone());
            }
            let ancestors = if latin.is_some() {
                &path[..]
            } else {
                &path[1..]
            };
            for (folder, limit) in ancestors {
                let current = result.limits.entry(folder.clone()).or_default();
                *current = (*current).max(*limit);
            }
            if rank < best_rank {
                result.best_id = Some(id.to_owned());
                result.initial_open = ancestors.iter().map(|(folder, _)| folder.clone()).collect();
                best_rank = rank;
            }
            result
                .folders
                .extend(path.into_iter().map(|(folder, _)| folder));
        }
        Some(result)
    }
}
