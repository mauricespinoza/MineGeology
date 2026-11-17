"""Reference photos of each unit: copied next to the scenario files and listed in the manifest (format 1.2.0)."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

PHOTO_KINDS = ("hand_sample", "thin_section_ppl", "thin_section_xpl", "outcrop")


def attach_photos(scenario_dir: Path, units_cfg: dict[str, dict[str, Any]], out: Path) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """Copies the photos named in scenario.yaml into out/photos.

    Returns the manifest's assets and, by unit key, the entries for units.json.
    """
    assets: list[dict[str, Any]] = []
    by_unit: dict[str, list[dict[str, Any]]] = {}
    if any(u.get("photos") for u in units_cfg.values()):
        (out / "photos").mkdir(parents=True, exist_ok=True)
    for unit in units_cfg.values():
        for photo in unit.get("photos", []):
            source = scenario_dir / photo["file"]
            if not source.exists():
                raise FileNotFoundError(f"{source} is named in scenario.yaml but does not exist")
            path = f"photos/{source.name}"
            shutil.copyfile(source, out / path)
            data = source.read_bytes()
            if all(a["path"] != path for a in assets):
                assets.append({"path": path, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
            entry = {"kind": photo["kind"], "path": path, "credit": photo["credit"], "licence": photo["licence"]}
            if photo.get("source"):
                entry["source"] = photo["source"]
            by_unit.setdefault(unit["key"], []).append(entry)
    return assets, by_unit


def add_photos_to_bake(scenario_dir: Path, units_cfg: dict[str, dict[str, Any]], folder: Path) -> int:
    """Adds or replaces the photos of a finished bake without baking again. Returns how many were attached."""
    for old in (folder / "photos").glob("*.jpg") if (folder / "photos").exists() else []:
        old.unlink()
    assets, by_unit = attach_photos(scenario_dir, units_cfg, folder)
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    units_entry = manifest["files"]["units"]
    units = json.loads((folder / units_entry["path"]).read_text(encoding="utf-8"))
    for u in units["units"]:
        u.pop("photos", None)
        if u["key"] in by_unit:
            u["photos"] = by_unit[u["key"]]
    data = (json.dumps(units, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    (folder / units_entry["path"]).write_bytes(data)
    units_entry["sha256"] = hashlib.sha256(data).hexdigest()
    units_entry["bytes"] = len(data)
    if assets:
        manifest["assets"] = assets
    else:
        manifest.pop("assets", None)
    major, minor, _ = (int(v) for v in manifest["format_version"].split("."))
    if (major, minor) < (1, 2):
        manifest["format_version"] = "1.2.0"
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return sum(len(v) for v in by_unit.values())
