use catalog::{Catalog, StudyTarget};
use icu_collator::{
    Collator, CollatorPreferences,
    options::{AlternateHandling, CollatorOptions, MaxVariable, Strength},
    preferences::CollationNumericOrdering,
};
use icu_normalizer::DecomposingNormalizer;
use icu_properties::{
    CodePointMapData, CodePointSetData,
    props::{Diacritic, GeneralCategory, GeneralCategoryGroup},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
};

#[derive(Clone, Deserialize, Serialize)]
pub struct Names {
    pub vi: String,
    pub en: String,
}

#[derive(Deserialize)]
struct Terminology {
    terms: HashMap<String, Names>,
}

#[derive(Deserialize)]
struct References {
    articles: HashMap<String, serde_json::Value>,
}

static REFERENCES: LazyLock<Result<References, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../content/wikipedia-references.json"))
        .map_err(|e| format!("References: {e}"))
});

pub fn reference(source: &str) -> Result<Option<&'static serde_json::Value>, String> {
    Ok(REFERENCES
        .as_ref()
        .map_err(Clone::clone)?
        .articles
        .get(source))
}

static TERMS: LazyLock<Result<Terminology, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../content/anatomy-terminology.json"))
        .map_err(|e| format!("Terminology: {e}"))
});

pub fn names(source: &str) -> Names {
    TERMS
        .as_ref()
        .ok()
        .and_then(|terms| terms.terms.get(source))
        .cloned()
        .unwrap_or_else(|| Names {
            vi: source.into(),
            en: source.into(),
        })
}

pub fn structure_names(source: &str, laterality: &str) -> Names {
    let mut result = names(source);
    let side = match laterality {
        "left" => Some(("trái", "left")),
        "right" => Some(("phải", "right")),
        _ => None,
    };
    if let Some((vi, en)) = side {
        result.vi += &format!(" · {vi}");
        result.en += &format!(" · {en}");
    }
    result
}

pub fn target_names(source: &str, title: &str) -> Names {
    let mut result = names(source);
    if title != source {
        result.vi = title.into();
    }
    result
}

pub fn normalize(value: &str) -> String {
    let lower = value.to_lowercase();
    let decomposed = DecomposingNormalizer::new_nfd().normalize(&lower);
    let diacritics = CodePointSetData::new::<Diacritic>();
    let categories = CodePointMapData::<GeneralCategory>::new();
    let mut result = String::new();
    let mut space = false;
    for mut ch in decomposed.chars() {
        if diacritics.contains(ch) {
            continue;
        }
        if ch == 'đ' {
            ch = 'd';
        }
        let category = categories.get(ch);
        if GeneralCategoryGroup::Letter.contains(category)
            || GeneralCategoryGroup::Number.contains(category)
        {
            if space {
                result.push(' ');
                space = false;
            }
            result.push(ch);
        } else if !result.is_empty() {
            space = true;
        }
    }
    result
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Structure {
    pub source_id: String,
    pub source_name: String,
    pub source_object: String,
    pub latin: String,
    pub laterality: String,
    pub collections: Vec<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
struct Metadata {
    structures: Vec<Structure>,
}

pub fn parse_metadata(json: &str, expected: &[String]) -> Result<Vec<Structure>, String> {
    let metadata: Metadata = serde_json::from_str(json).map_err(|_| "Metadata không hợp lệ")?;
    let ids: HashSet<_> = metadata
        .structures
        .iter()
        .map(|part| &part.source_id)
        .collect();
    if metadata.structures.is_empty()
        || ids.len() != metadata.structures.len()
        || metadata.structures.iter().any(|part| {
            part.source_id.is_empty()
                || part.source_name.is_empty()
                || !["", "left", "right"].contains(&part.laterality.as_str())
        })
    {
        return Err("Metadata không hợp lệ".into());
    }
    let expected_ids: HashSet<_> = expected.iter().collect();
    if expected_ids.len() != expected.len() || ids != expected_ids {
        return Err("Metadata không khớp catalog".into());
    }
    Ok(metadata.structures)
}

#[derive(Serialize)]
pub struct ModelView<'a> {
    path: &'a str,
    scope: &'a str,
}

#[derive(Serialize)]
pub struct TargetView<'a> {
    pub id: &'a str,
    pub source_name: &'a str,
    pub names: Names,
    pub count: usize,
    pub parent_id: Option<&'a str>,
    pub model: Option<ModelView<'a>>,
}

#[derive(Serialize)]
pub struct StructureRow<'a> {
    pub source_id: &'a str,
    pub names: Names,
    pub latin: &'a str,
}

#[derive(Serialize)]
pub struct StructureDetail<'a> {
    #[serde(flatten)]
    pub structure: &'a Structure,
    pub names: Names,
    pub collection_names: Vec<Names>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum SearchRow<'a> {
    Structure(StructureRow<'a>),
    Target(TargetView<'a>),
}

#[derive(Serialize)]
pub struct SearchPage<'a> {
    pub total: usize,
    pub items: Vec<SearchRow<'a>>,
}

#[derive(Serialize)]
pub struct FolderView<'a> {
    pub target: TargetView<'a>,
    pub visible: usize,
    pub children: Vec<FolderView<'a>>,
    pub structures: Vec<StructureRow<'a>>,
    pub more: bool,
    pub limit: usize,
    pub total: usize,
}

struct Entry {
    exact: Vec<String>,
    text: String,
}

enum SearchHit {
    Structure(usize),
    Target(usize),
}

pub struct CatalogData {
    pub catalog: Catalog,
    targets: HashMap<String, usize>,
    children: Vec<Vec<usize>>,
    roots: Vec<usize>,
    direct: Vec<Vec<String>>,
    reveal_targets: HashMap<String, usize>,
    structures: Vec<Structure>,
    structure_index: HashMap<String, usize>,
    order: Vec<usize>,
    alphabetical: [Vec<usize>; 2],
    entries: Vec<Entry>,
    target_entries: Vec<(usize, Entry)>,
}

impl CatalogData {
    pub fn from_json(json: &str) -> Result<Self, String> {
        TERMS.as_ref().map_err(Clone::clone)?;
        let catalog = Catalog::from_json(json).map_err(|e| e.to_string())?;
        let targets: HashMap<_, _> = catalog
            .targets
            .iter()
            .enumerate()
            .map(|(i, t)| (t.id.clone(), i))
            .collect();
        let mut children = vec![Vec::new(); catalog.targets.len()];
        let mut roots = Vec::new();
        for (i, target) in catalog.targets.iter().enumerate() {
            if let Some(parent) = &target.parent_id {
                children[targets[parent]].push(i);
            } else {
                roots.push(i);
            }
        }
        let system_order = [
            "group:skeletal-system",
            "group:muscular-insertions",
            "group:joints",
            "group:lymphoid-organs",
            "group:cardiovascular-system",
            "group:nervous-system",
            "group:visceral-systems",
            "group:muscular-system",
            "group:body-regions",
        ];
        roots.sort_by_key(|i| {
            system_order
                .iter()
                .position(|id| *id == catalog.targets[*i].group_id)
                .unwrap_or(usize::MAX)
        });
        let direct: Vec<Vec<String>> = catalog
            .targets
            .iter()
            .enumerate()
            .map(|(i, target)| {
                let nested: HashSet<_> = children[i]
                    .iter()
                    .flat_map(|child| &catalog.targets[*child].structure_ids)
                    .collect();
                Self::ids(target)
                    .iter()
                    .filter(|id| !nested.contains(id))
                    .cloned()
                    .collect()
            })
            .collect();
        let mut reveal_targets = HashMap::new();
        for (i, ids) in direct.iter().enumerate() {
            for id in ids {
                reveal_targets.entry(id.clone()).or_insert(i);
            }
        }
        Ok(Self {
            catalog,
            targets,
            children,
            roots,
            direct,
            reveal_targets,
            structures: Vec::new(),
            structure_index: HashMap::new(),
            order: Vec::new(),
            alphabetical: [Vec::new(), Vec::new()],
            entries: Vec::new(),
            target_entries: Vec::new(),
        })
    }

    fn ids(target: &StudyTarget) -> &[String] {
        target
            .model
            .as_ref()
            .map_or(&target.structure_ids, |model| &model.structure_ids)
    }

    pub fn members(&self, id: &str) -> Option<&[String]> {
        self.targets
            .get(id)
            .map(|i| Self::ids(&self.catalog.targets[*i]))
    }

    fn target_at(&self, i: usize) -> TargetView<'_> {
        let target = &self.catalog.targets[i];
        TargetView {
            id: &target.id,
            source_name: &target.source_name,
            names: target_names(&target.source_name, &target.title),
            count: Self::ids(target).len(),
            parent_id: target.parent_id.as_deref(),
            model: target.model.as_ref().map(|m| ModelView {
                path: &m.path,
                scope: &m.scope,
            }),
        }
    }

    pub fn target(&self, id: &str) -> Option<TargetView<'_>> {
        self.targets.get(id).map(|i| self.target_at(*i))
    }

    pub fn roots(&self) -> Vec<TargetView<'_>> {
        self.catalog
            .targets
            .iter()
            .enumerate()
            .filter(|(_, target)| target.model.is_some())
            .map(|(i, _)| self.target_at(i))
            .collect()
    }

    pub fn clear_metadata(&mut self) {
        self.structures.clear();
        self.structure_index.clear();
        self.order.clear();
        self.entries.clear();
        self.target_entries.clear();
        self.alphabetical = [Vec::new(), Vec::new()];
    }

    pub fn ingest(&mut self, root: &str, json: &str) -> Result<Vec<String>, String> {
        let target = self
            .targets
            .get(root)
            .map(|i| &self.catalog.targets[*i])
            .ok_or("Unknown model root")?;
        let model = target.model.as_ref().ok_or("Target has no model")?;
        let parts = parse_metadata(json, &model.structure_ids)?;
        let ids = parts.iter().map(|p| p.source_id.clone()).collect();
        for part in parts {
            if let Some(index) = self.structure_index.get(&part.source_id) {
                self.structures[*index] = part;
            } else {
                self.structure_index
                    .insert(part.source_id.clone(), self.structures.len());
                self.structures.push(part);
            }
        }
        Ok(ids)
    }

    pub fn finish(&mut self, host_locale: &str) -> Result<(), String> {
        let collator = |locale: &str, base: bool| {
            let locale: icu_locale_core::Locale = locale
                .parse()
                .map_err(|e| format!("Collation locale: {e}"))?;
            let mut preferences: CollatorPreferences = locale.into();
            let mut options = CollatorOptions::default();
            if base {
                preferences.numeric_ordering = Some(CollationNumericOrdering::True);
                options.strength = Some(Strength::Primary);
                options.alternate_handling = Some(AlternateHandling::Shifted);
                options.max_variable = Some(MaxVariable::Punctuation);
            }
            Collator::try_new(preferences, options).map_err(|e| format!("Collation: {e}"))
        };
        let collators = [
            collator("vi", false)?,
            collator("vi", true)?,
            collator("en", true)?,
            collator(host_locale, false)?,
        ];
        let compare = |a: &str, b: &str, mode: usize| collators[mode].compare(a, b);
        let labels: Vec<_> = self
            .structures
            .iter()
            .map(|p| structure_names(&p.source_name, &p.laterality))
            .collect();
        self.order = (0..self.structures.len()).collect();
        self.order.sort_by(|a, b| {
            compare(&labels[*a].vi, &labels[*b].vi, 0).then_with(|| {
                compare(
                    &self.structures[*a].source_object,
                    &self.structures[*b].source_object,
                    3,
                )
            })
        });
        let letter = CodePointMapData::<GeneralCategory>::new();
        for language in 0..2 {
            let label = |i: usize| {
                if language == 0 {
                    &labels[i].vi
                } else {
                    &labels[i].en
                }
            };
            let has_letters: Vec<_> = (0..labels.len())
                .map(|i| {
                    label(i)
                        .chars()
                        .any(|c| GeneralCategoryGroup::Letter.contains(letter.get(c)))
                })
                .collect();
            self.alphabetical[language] = self.order.clone();
            self.alphabetical[language].sort_by(|a, b| {
                has_letters[*b]
                    .cmp(&has_letters[*a])
                    .then_with(|| compare(label(*a), label(*b), language + 1))
            });
        }
        self.entries = self
            .structures
            .iter()
            .enumerate()
            .map(|(i, part)| {
                let names = names(&part.source_name);
                let sides = match part.laterality.as_str() {
                    "left" => Some(["trai", "left"]),
                    "right" => Some(["phai", "right"]),
                    _ => None,
                };
                let exact = [&part.source_name, &names.vi, &names.en]
                    .into_iter()
                    .flat_map(|name| {
                        let base = normalize(name);
                        let mut values = vec![base.clone()];
                        if let Some(sides) = sides {
                            for side in sides {
                                values.push(format!("{base} {side}"));
                            }
                        }
                        values
                    })
                    .collect();
                Entry {
                    exact,
                    text: normalize(&format!(
                        "{} {} {} {} {}",
                        labels[i].vi,
                        labels[i].en,
                        part.source_name,
                        part.latin,
                        part.source_object
                    )),
                }
            })
            .collect();
        self.target_entries = self
            .catalog
            .targets
            .iter()
            .enumerate()
            .filter(|(_, target)| {
                Self::ids(target)
                    .iter()
                    .any(|id| self.structure_index.contains_key(id))
            })
            .map(|(i, target)| {
                let names = target_names(&target.source_name, &target.title);
                let exact: Vec<_> = [&target.source_name, &names.vi, &names.en]
                    .into_iter()
                    .map(|name| normalize(name))
                    .collect();
                let text = exact.join(" ");
                (i, Entry { exact, text })
            })
            .collect();
        Ok(())
    }

    pub fn identities(&self) -> Vec<&str> {
        self.order
            .iter()
            .map(|i| self.structures[*i].source_id.as_str())
            .collect()
    }

    fn row(&self, i: usize) -> StructureRow<'_> {
        let part = &self.structures[i];
        StructureRow {
            source_id: &part.source_id,
            names: structure_names(&part.source_name, &part.laterality),
            latin: &part.latin,
        }
    }

    pub fn detail(&self, id: &str) -> Option<StructureDetail<'_>> {
        self.structure_index.get(id).map(|i| {
            let part = &self.structures[*i];
            StructureDetail {
                structure: part,
                names: structure_names(&part.source_name, &part.laterality),
                collection_names: part
                    .collections
                    .iter()
                    .filter(|name| {
                        !(name.as_bytes().first().is_some_and(u8::is_ascii_digit)
                            && name.as_bytes().get(1) == Some(&b':'))
                    })
                    .map(|name| names(name))
                    .collect(),
            }
        })
    }

    pub fn search(&self, query: &str, language: &str, limit: usize) -> SearchPage<'_> {
        if query.trim().is_empty() {
            let order = &self.alphabetical[usize::from(language == "en")];
            return SearchPage {
                total: order.len(),
                items: order
                    .iter()
                    .take(limit)
                    .map(|i| SearchRow::Structure(self.row(*i)))
                    .collect(),
            };
        }
        let query = normalize(query);
        let words: Vec<_> = query
            .split_whitespace()
            .map(memchr::memmem::Finder::new)
            .collect();
        let mut matches = Vec::new();
        let mut other = Vec::new();
        if !words.is_empty() {
            let entries = self
                .order
                .iter()
                .map(|i| (&self.entries[*i], SearchHit::Structure(*i)))
                .chain(
                    self.target_entries
                        .iter()
                        .map(|(i, entry)| (entry, SearchHit::Target(*i))),
                );
            for (entry, hit) in entries {
                let text = entry.text.as_bytes();
                if words.iter().all(|word| {
                    word.find_iter(text)
                        .any(|start| start == 0 || text[start - 1] == b' ')
                }) {
                    if entry.exact.contains(&query) {
                        matches.push(hit);
                    } else {
                        other.push(hit);
                    }
                }
            }
        }
        matches.extend(other);
        SearchPage {
            total: matches.len(),
            items: matches
                .into_iter()
                .take(limit)
                .map(|hit| match hit {
                    SearchHit::Structure(i) => SearchRow::Structure(self.row(i)),
                    SearchHit::Target(i) => SearchRow::Target(self.target_at(i)),
                })
                .collect(),
        }
    }

    pub fn reveal(&self, id: &str) -> Vec<(String, usize)> {
        let mut target = self
            .reveal_targets
            .get(id)
            .or_else(|| self.targets.get(id))
            .copied();
        let mut path = Vec::new();
        while let Some(i) = target {
            let entry = &self.catalog.targets[i];
            let limit = self.direct[i]
                .iter()
                .position(|value| value == id)
                .map_or(40, |p| (p + 1).max(40));
            path.push((entry.id.clone(), limit));
            target = entry.parent_id.as_ref().map(|parent| self.targets[parent]);
        }
        path
    }

    pub fn tree(
        &self,
        open: &HashSet<String>,
        limits: &HashMap<String, usize>,
        visible: &HashSet<String>,
    ) -> Vec<FolderView<'_>> {
        self.roots
            .iter()
            .map(|i| self.folder(*i, open, limits, visible))
            .collect()
    }

    fn folder(
        &self,
        i: usize,
        open: &HashSet<String>,
        limits: &HashMap<String, usize>,
        visible: &HashSet<String>,
    ) -> FolderView<'_> {
        let target = &self.catalog.targets[i];
        let opened = open.contains(&target.id);
        let limit = limits.get(&target.id).copied().unwrap_or(40);
        FolderView {
            target: self.target_at(i),
            visible: Self::ids(target)
                .iter()
                .filter(|id| visible.contains(*id))
                .count(),
            children: if opened {
                self.children[i]
                    .iter()
                    .map(|child| self.folder(*child, open, limits, visible))
                    .collect()
            } else {
                Vec::new()
            },
            structures: if opened {
                self.direct[i]
                    .iter()
                    .take(limit)
                    .filter_map(|id| self.structure_index.get(id))
                    .map(|i| self.row(*i))
                    .collect()
            } else {
                Vec::new()
            },
            more: opened && limit < self.direct[i].len(),
            limit,
            total: self.direct[i].len(),
        }
    }
}
