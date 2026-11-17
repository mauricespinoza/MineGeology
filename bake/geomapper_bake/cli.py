"""Command line: `geomapper bake <scenario>` and `geomapper validate <folder>`."""

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
    bake_cmd = sub.add_parser("bake", help="bake a scenario folder (model.py and scenario.yaml) into static files")
    bake_cmd.add_argument("scenario")
    bake_cmd.add_argument("--variant", help="variant name from scenario.yaml; default: the first one")
    bake_cmd.add_argument("--out", help="output folder; default: build/<id>-<variant>")
    bake_cmd.add_argument("--coarsen", type=int, default=1, metavar="N", help="quick draft with cells N times larger")
    bake_cmd.add_argument("--report", action="store_true", help="also write report.html, the validation report")
    args = parser.parse_args(argv)

    if args.command == "bake":
        # Imported here so that `validate` works without GemPy installed.
        from .bake import BakeError, bake
        from .scenario_config import ConfigError

        try:
            result = bake(args.scenario, args.out, args.variant, coarsen=args.coarsen, report=args.report)
        except (ConfigError, BakeError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        contacts = result.truth["contacts"]["features"]
        faults = sum(f["properties"]["type"] == "fault" for f in contacts)
        print(f"baked {result.config['id']} (variant {result.config.variant}) into {result.folder}")
        print(f"{len(result.unit_names)} units, {len(contacts) - faults} contact traces, {faults} fault traces")
        exposed = (result.outcrop_labels > 0).mean()
        print(f"{len(result.outcrops)} outcrops, {100 * exposed:.1f} % of the area exposed")
        if args.report:
            print(f"validation report: {result.folder / 'report.html'}")
        return 0

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
