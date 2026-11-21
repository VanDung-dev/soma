---
name: jsonl-storage
description: Choose, migrate, or validate JSON and JSONL storage for record collections in Soma. Use when changing persisted JSON collection formats or record schemas.
---

# JSONL storage workflow

Use `scripts/jsonl_storage.py` for generic JSONL validation and conversion without editing the script. It uses only Python's standard library; run it with the repository `.venv`.

```sh
.venv/bin/python scripts/jsonl_storage.py validate records.jsonl
.venv/bin/python scripts/jsonl_storage.py to-jsonl records.json
.venv/bin/python scripts/jsonl_storage.py to-json records.jsonl
```

Conversions default to the same basename with the target extension and refuse to overwrite. Pass `-o PATH` to choose an output path and `--overwrite` to replace an existing output. The utility validates JSON syntax and top-level collection shape; it does not know application-specific schemas or semantic constraints.

1. Prefer JSONL for collections that are appended, streamed, diffed, or processed one record at a time. Write one complete JSON value per line, without an enclosing array or pretty-printing.
2. Keep JSONL canonical. Use a single JSON document only when a consumer requires one document, a schema mandates an array, or record data must be combined with non-record metadata.
3. When a single JSON document is required for records, use a top-level array of complete, independent records. Preserve the JSONL field names, field order, and value shapes so conversion remains mechanical.
4. Do not make records depend on array position or prior records. Avoid shared mutable keys, cross-record positional references, nested record documents, ID-keyed objects, and wrapper envelopes such as `{ "items": [...] }` when a flat collection is sufficient.
5. Validate that every JSONL line parses independently or that the JSON fallback parses as one document and matches its consumer's schema. The utility handles syntax and collection shape; validate domain-specific schema requirements separately.
6. When using JSON instead of JSONL, report the format and why the consumer or schema requires the fallback.
