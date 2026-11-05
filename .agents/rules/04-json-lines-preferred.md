# JSON and JSONL storage shape

- Prefer JSONL (newline-delimited JSON) for record collections that are appended, streamed, diffed, or processed one record at a time. Write one self-contained JSON value per line with no wrapping array and no pretty-printing.
- Convert an existing JSON collection to JSONL whenever the consumer can read line-by-line. Do not add a container array or trailing separators.
- When JSONL is not possible — a consumer requires a single JSON document, a schema mandates an array, or the file must be pretty-printed or merged with non-record metadata — keep a JSONL-shaped JSON file: a top-level array of complete, self-contained records in the same field order and shape JSONL would use.
- Keep each record independent in every case: no record may depend on the position of a previous record, no shared mutable keys, and no cross-record references that break when lines are reordered.
- Do not fall back to nested documents, one giant object keyed by record ID, or wrapped envelopes such as `{ "items": [...] }` when the flat record array would answer the same need.
- Use the same field names, ordering, and value shapes in JSON and JSONL forms so the two can be converted mechanically. Keep JSONL as the canonical form and treat differently shaped JSON as a deliberate exception.
- State in the task output which format was written and why JSONL could not be used when a JSON fallback was taken.
