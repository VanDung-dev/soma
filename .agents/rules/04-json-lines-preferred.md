# JSON Lines preference

- Prefer JSONL for record collections that can be read or processed one record at a time. Use a single JSON document only when the consumer or schema requires it, or records must be combined with non-record metadata.
- For record shape, conversion, and validation details, follow `.agents/skills/jsonl-storage/SKILL.md` when changing stored JSON collections.
