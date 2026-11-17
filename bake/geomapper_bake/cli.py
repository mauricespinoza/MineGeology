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
    publish = sub.add_parser("publish", help="copy the public files of a baked scenario, without the answer key")
    publish.add_argument("folder", help="a full bake output")
    publish.add_argument("dest", help="destination folder, e.g. baked/<id>-<variant>")
    publish.add_argument(
        "--practice",
        action="store_true",
        help="also write practice.bin and practice-litho.bin, the answer key and the block lightly obfuscated, for ungraded practice on static hosting",
    )
    photos_cmd = sub.add_parser("photos", help="add or replace the reference photos of a finished bake, without baking again")
    photos_cmd.add_argument("scenario", help="the scenario folder, with scenario.yaml")
    photos_cmd.add_argument("folder", help="a full bake output of that scenario")
    args = parser.parse_args(argv)

    if args.command == "photos":
        from pathlib import Path

        from .photos import add_photos_to_bake
        from .scenario_config import ConfigError, load_config

        try:
            cfg = load_config(args.scenario)
            n = add_photos_to_bake(Path(args.scenario), cfg["units"], Path(args.folder))
        except (ConfigError, FileNotFoundError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        report = validate_scenario(args.folder)
        for message in report.errors:
            print(f"error: {message}", file=sys.stderr)
        print(f"attached {n} photos to {args.folder}")
        return 0 if report.ok else 1

    if args.command == "publish":
        import json
        import shutil
        from pathlib import Path

        source, dest = Path(args.folder), Path(args.dest)
        report = validate_scenario(source)
        if not report.ok:
            print(f"error: {source} is not a valid scenario; run geomapper validate", file=sys.stderr)
            return 1
        manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
        dest.mkdir(parents=True, exist_ok=True)
        names = ["manifest.json"] + [f["path"] for f in manifest["files"].values() if f["visibility"] == "public"]
        names += [a["path"] for a in manifest.get("assets", [])]
        if (dest / "photos").exists():
            shutil.rmtree(dest / "photos")
        for name in names:
            (dest / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / name, dest / name)
        if args.practice:
            from .scenario_format import obfuscate

            truth = manifest["files"]["truth"]
            (dest / "practice.bin").write_bytes(obfuscate((source / truth["path"]).read_bytes(), truth["sha256"]))
            names.append("practice.bin")
            # The grader cuts the true cross-section from the block, so practice needs it too.
            litho = manifest["files"]["litho"]
            (dest / "practice-litho.bin").write_bytes(obfuscate((source / litho["path"]).read_bytes(), litho["sha256"]))
            names.append("practice-litho.bin")
        else:
            for name in ("practice.bin", "practice-litho.bin"):
                if (dest / name).exists():
                    (dest / name).unlink()
        print(f"published {', '.join(names)} to {dest}")
        return 0

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
