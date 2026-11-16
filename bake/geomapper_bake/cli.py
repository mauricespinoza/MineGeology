"""Command line: `geomapper validate <folder>`. The `bake` command arrives with work package 2."""

from __future__ import annotations

import argparse
import sys

from .scenario_format import FormatError, validate_scenario


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="geomapper")
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate", help="check a baked scenario folder against the format")
    validate.add_argument("folder")
    validate.add_argument(
        "--public", action="store_true", help="accept a public bundle without reveal and truth files"
    )
    args = parser.parse_args(argv)

    try:
        report = validate_scenario(args.folder, require_all=not args.public)
    except FormatError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    for message in report.errors:
        print(f"error: {message}", file=sys.stderr)
    if report.skipped:
        print(f"not present, not checked: {', '.join(report.skipped)}")
    print(f"checked: {', '.join(report.checked)}")
    print("valid" if report.ok else f"{len(report.errors)} error(s)")
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
