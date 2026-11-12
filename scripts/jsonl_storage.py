import argparse
import json
from pathlib import Path


def reject_constant(value):
    raise ValueError(f"invalid JSON constant: {value}")


def load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_constant)
    except json.JSONDecodeError as error:
        raise ValueError(f"{path}:{error.lineno}:{error.colno}: {error.msg}") from error


def load_jsonl(path):
    records = []
    with path.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                raise ValueError(f"{path}:{line_number}: blank lines are not valid JSONL records")
            try:
                records.append(json.loads(line, parse_constant=reject_constant))
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{line_number}:{error.colno}: {error.msg}") from error
    return records


def output_path(source, output, suffix, overwrite):
    target = output or source.with_suffix(suffix)
    if target.resolve() == source.resolve():
        raise ValueError("input and output paths must be different")
    if target.exists() and not overwrite:
        raise ValueError(f"{target} already exists; pass --overwrite to replace it")
    return target


def main():
    parser = argparse.ArgumentParser(description="Validate or convert JSON record collections.")
    commands = parser.add_subparsers(dest="command", required=True)

    validate = commands.add_parser("validate", help="validate one JSON value per JSONL line")
    validate.add_argument("input", type=Path)

    for name, suffix in (("to-jsonl", ".jsonl"), ("to-json", ".json")):
        command = commands.add_parser(name)
        command.add_argument("input", type=Path)
        command.add_argument("-o", "--output", type=Path)
        command.add_argument("--overwrite", action="store_true")
        command.set_defaults(output_suffix=suffix)

    args = parser.parse_args()
    try:
        if args.command == "validate":
            count = len(load_jsonl(args.input))
            print(f"Valid JSONL: {count} records")
            return 0

        target = output_path(args.input, args.output, args.output_suffix, args.overwrite)
        if args.command == "to-jsonl":
            records = load_json(args.input)
            if not isinstance(records, list):
                raise ValueError(f"{args.input}: expected a top-level JSON array")
            content = "\n".join(json.dumps(record, ensure_ascii=False, separators=(",", ":"), allow_nan=False) for record in records)
            if records:
                content += "\n"
        else:
            records = load_jsonl(args.input)
            content = json.dumps(records, ensure_ascii=False, indent=2, allow_nan=False) + "\n"

        target.write_text(content, encoding="utf-8")
        print(f"Wrote {len(records)} records to {target}")
        return 0
    except (OSError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
