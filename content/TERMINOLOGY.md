# Vietnamese and English anatomy names

`anatomy-terminology.json` is a display glossary keyed by the **exact source name**. Each entry has separate `vi` and `en` names. Vietnamese is the default in the tree, search results, hover labels and information panel; English appears underneath. Latin remains a separate field from the original metadata. Search accepts all three, including Vietnamese without diacritics and Vietnamese or English laterality.

The Vietnamese labels are project-authored drafts, including expanded names for repeated anatomical parts. They have not received an independent medical terminology review. They are not an official Vietnamese edition of [FIPAT Terminologia Anatomica](https://ifaa.net/committees/anatomical-terminology-fipat/fipat-ifaa-terminologies/). FIPAT's Latin terminology and English equivalents are reference nomenclature; a valid UI mapping does not establish anatomical accuracy.

The English display field follows the source wording, with surrounding whitespace, technical attachment suffixes such as `.e1`, outer variant parentheses and root numbering removed where applicable. This does not correct the source's anatomical claims or numbering. For example, liver segment labels retain the source's stated position and segment number even when these need review. The raw English name, object name, Latin, structure IDs, hierarchy, model files and Wikipedia mappings remain unchanged. Wikipedia article content still uses the existing English links.

## Coverage and unresolved source labels

The initial glossary covers **3,658 of 3,666 distinct source names** across the model inventory and catalog, and **3,863 of 3,874 model structures**. It also translates the metadata-only `Bonus collection` label. Eight source labels remain untranslated because their identity or intended wording needs source inspection:

- `????????`
- `?x`
- `Insertions of adductor hallucis brevis`
- `Insertions of coracoradialis muscle`
- `Lat_Fis-ant-Horizont`
- `Lat_Fis-ant-Vertical`
- `Lat_Fis-post`
- `Sulcus interm_prim-Jensen`

These labels, and any new names added by a later model import, fall back to the original name. The app never creates a translation by matching a substring or translating unknown anatomical names at runtime.

## Editing and reuse

Update `vi` to refine a draft translation; retain the exact JSON key so its source identity stays stable. `en` is the international/source display name, not an identifier. Check the actual structure and its Latin field when correcting ambiguous terms. This glossary is maintained separately from `anatomy-names.json`, so running the model importer does not overwrite translations.

`apps/web/src/anatomy-names.ts` centralizes display and laterality with a `vi | en` language argument. The language selector in Settings uses that argument to change the primary anatomy label while preserving source metadata and reference keys. User-interface strings are loaded from `ui-translations.json`; those translations remain drafts and can be refined without changing anatomy source data.

Run `npm test`, `npm run check`, and `npm run build` after editing. The glossary test checks source keys, nonempty bilingual fields, fallback behavior, source immutability and at least 99% model coverage. The search/browser checks verify that Vietnamese, English and Latin identify the same model structure. These checks validate software behavior, not the medical correctness of the translations.
