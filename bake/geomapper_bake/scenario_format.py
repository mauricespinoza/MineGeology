"""Read and validate a baked scenario folder against format/ (see format/SPEC.md)."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

SUPPORTED_MAJOR = 1
COVER_CLASSES = ("bare_rock", "soil", "alluvium", "scree", "vegetation")
JSON_ROLES = ("outcrops", "units", "truth")


class FormatError(Exception):
    """The scenario cannot be read at all (bad manifest, unsupported version)."""


def schema_dir() -> Path:
    override = os.environ.get("GEOMAPPER_FORMAT_DIR")
    return Path(override) if override else Path(__file__).resolve().parents[2] / "format" / "schemas"


def load_schema(name: str) -> dict[str, Any]:
    return json.loads((schema_dir() / f"{name}.schema.json").read_text(encoding="utf-8"))


def decode_u16le(data: bytes) -> list[int]:
    raw = gzip.decompress(data)
    if len(raw) % 2:
        raise ValueError("odd byte count for a uint16 grid")
    return list(struct.unpack(f"<{len(raw) // 2}H", raw))


def decode_u8(data: bytes) -> bytes:
    return gzip.decompress(data)


def decode_rle8(data: bytes) -> bytes:
    """Records of (value: uint8, run length: uint16 little-endian, 1 to 65535)."""
    raw = gzip.decompress(data)
    if len(raw) % 3:
        raise ValueError("run-length data is not a whole number of 3-byte records")
    out = bytearray()
    for value, run in struct.iter_unpack("<BH", raw):
        if run == 0:
            raise ValueError("zero-length run")
        out += bytes([value]) * run
    return bytes(out)


def encode_rle8(values: bytes) -> bytes:
    out = bytearray()
    i = 0
    while i < len(values):
        run = 1
        while i + run < len(values) and values[i + run] == values[i] and run < 65535:
            run += 1
        out += struct.pack("<BH", values[i], run)
        i += run
    return gzip.compress(bytes(out), compresslevel=9, mtime=0)


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    checked: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _schema_errors(name: str, doc: Any) -> list[str]:
    validator = Draft202012Validator(load_schema(name))
    return [
        f"{name}.json: {'/'.join(str(p) for p in e.absolute_path) or '(root)'}: {e.message}"
        for e in sorted(validator.iter_errors(doc), key=lambda e: list(e.absolute_path))
    ]


def validate_scenario(folder: Path | str, require_all: bool = True) -> Report:
    """Check schemas, hashes, array sizes and cross-file references.

    With require_all=False, reveal and truth files may be absent, as in a
    public bundle; whatever is present is still checked.
    """
    folder = Path(folder)
    report = Report()
    try:
        manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FormatError(f"cannot read manifest.json: {exc}") from exc

    version = manifest.get("format_version") if isinstance(manifest, dict) else None
    try:
        major = int(str(version).split(".")[0])
    except ValueError as exc:
        raise FormatError(f"manifest.json has no usable format_version: {version!r}") from exc
    if major > SUPPORTED_MAJOR:
        raise FormatError(
            f"scenario uses format {version}, newer than the supported major version {SUPPORTED_MAJOR}"
        )

    report.errors += _schema_errors("manifest", manifest)
    if report.errors:
        return report
    report.checked.append("manifest")

    grid = manifest["grid"]
    nx, ny, nz = grid["nx"], grid["ny"], grid["nz"]
    raw: dict[str, bytes] = {}
    for role, entry in manifest["files"].items():
        path = folder / entry["path"]
        if not path.exists():
            if require_all or entry["visibility"] == "public":
                report.errors.append(f"{entry['path']}: missing")
            else:
                report.skipped.append(role)
            continue
        data = path.read_bytes()
        if len(data) != entry["bytes"]:
            report.errors.append(f"{entry['path']}: {len(data)} bytes, manifest says {entry['bytes']}")
        if hashlib.sha256(data).hexdigest() != entry["sha256"]:
            report.errors.append(f"{entry['path']}: sha256 does not match the manifest")
        raw[role] = data
        report.checked.append(role)

    docs: dict[str, Any] = {}
    for role in JSON_ROLES:
        if role not in raw:
            continue
        try:
            docs[role] = json.loads(raw[role].decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            report.errors.append(f"{role}.json: not valid JSON: {exc}")
            continue
        errors = _schema_errors(role, docs[role])
        if errors:
            report.errors += errors
            del docs[role]

    arrays: dict[str, Any] = {}
    decoders = {"terrain": decode_u16le, "cover": decode_u8, "litho": decode_rle8, "orient": decode_u8}
    expected = {
        "terrain": nx * ny,
        "cover": nx * ny,
        "litho": nx * ny * nz,
        "orient": nx * ny * nz * 3 * len(manifest["series"]),
    }
    for role, decode in decoders.items():
        if role not in raw:
            continue
        try:
            values = decode(raw[role])
        except (OSError, EOFError, ValueError, struct.error) as exc:
            report.errors.append(f"{manifest['files'][role]['path']}: cannot decode: {exc}")
            continue
        if len(values) != expected[role]:
            report.errors.append(
                f"{manifest['files'][role]['path']}: {len(values)} values, grid needs {expected[role]}"
            )
            continue
        arrays[role] = values

    unit_keys = [u["key"] for u in docs["units"]["units"]] if "units" in docs else None
    if unit_keys is not None and len(set(unit_keys)) != len(unit_keys):
        report.errors.append("units.json: duplicate unit keys")

    if "terrain" in arrays:
        t = manifest["terrain"]
        low = grid["origin"]["elevation"]
        high = low + nz * grid["cell_size_m"]["z"]
        elev = [t["offset_m"] + v * t["scale_m"] for v in arrays["terrain"]]
        if min(elev) < low or max(elev) > high:
            report.errors.append(
                f"terrain: elevations {min(elev):.1f} to {max(elev):.1f} m leave the block ({low} to {high} m)"
            )

    if "cover" in arrays and max(arrays["cover"]) >= len(COVER_CLASSES):
        report.errors.append(f"cover: class {max(arrays['cover'])} is not defined")

    if "litho" in arrays and unit_keys is not None and max(arrays["litho"]) >= len(unit_keys):
        report.errors.append(f"litho: unit index {max(arrays['litho'])} has no entry in units.json")

    if "orient" in arrays:
        vectors = struct.iter_unpack("<3b", arrays["orient"])
        bad = sum(1 for v in vectors if any(v) and abs((v[0] ** 2 + v[1] ** 2 + v[2] ** 2) ** 0.5 - 127) > 3)
        if bad:
            report.errors.append(f"orient: {bad} poles are neither unit vectors nor the (0,0,0) mask")

    if "outcrops" in docs:
        seen_ids: set[str] = set()
        seen_cells: set[tuple[int, int]] = set()
        for o in docs["outcrops"]["outcrops"]:
            oid = o["id"]
            if oid in seen_ids:
                report.errors.append(f"outcrops: duplicate id {oid}")
            seen_ids.add(oid)
            for ix, iy in o["cells"]:
                if ix >= nx or iy >= ny:
                    report.errors.append(f"outcrops: {oid} cell [{ix}, {iy}] is outside the grid")
                    continue
                if (ix, iy) in seen_cells:
                    report.errors.append(f"outcrops: cell [{ix}, {iy}] belongs to two outcrops")
                seen_cells.add((ix, iy))
                if "cover" in arrays and arrays["cover"][ix + nx * iy] != 0:
                    report.errors.append(f"outcrops: {oid} cell [{ix}, {iy}] is not bare rock in cover.bin")
            obs = o.get("observation")
            if obs is None or unit_keys is None:
                continue
            used = [obs["unit"], *obs.get("contact", {}).get("units", [])]
            for key in used:
                if key not in unit_keys:
                    report.errors.append(f"outcrops: {oid} refers to unknown unit {key}")
            plane_ids = [p["id"] for p in obs["planes"]]
            if len(set(plane_ids)) != len(plane_ids):
                report.errors.append(f"outcrops: {oid} has duplicate plane ids")
            ref = obs.get("contact", {}).get("plane")
            if ref is not None and ref not in plane_ids:
                report.errors.append(f"outcrops: {oid} contact refers to unknown plane {ref}")
        if "cover" in arrays:
            stray = sum(
                1 for i, c in enumerate(arrays["cover"]) if c == 0 and (i % nx, i // nx) not in seen_cells
            )
            if stray:
                report.errors.append(f"cover: {stray} bare-rock cells belong to no outcrop")

    if "truth" in docs:
        truth = docs["truth"]
        truth_keys = [u["key"] for u in truth["units"]]
        if unit_keys is not None and truth_keys != unit_keys:
            report.errors.append("truth: units differ from units.json in key or order")
        series = {s["key"] for s in manifest["series"]}
        for u in truth["units"]:
            if "series" in u and u["series"] not in series:
                report.errors.append(f"truth: unit {u['key']} refers to unknown series {u['series']}")
        refs = [c["unit"] for c in truth["column"]]
        refs += [k for e in truth["events"] for k in e.get("units", [])]
        refs += [k for f in truth["contacts"]["features"] for k in f["properties"].get("units", [])]
        refs += [k for group in truth["lumpable"] for k in group]
        for key in sorted(set(refs) - set(truth_keys)):
            report.errors.append(f"truth: reference to unknown unit {key}")
        cells = sum(run for _, run in truth["map"]["runs"])
        if cells != nx * ny:
            report.errors.append(f"truth: map has {cells} cells, grid needs {nx * ny}")
        if any(index >= len(truth_keys) for index, _ in truth["map"]["runs"]):
            report.errors.append("truth: map uses a unit index with no unit")
        if "outcrops" in docs:
            known = {o["id"] for o in docs["outcrops"]["outcrops"]}
            for oid in truth["key_outcrops"]:
                if oid not in known:
                    report.errors.append(f"truth: key outcrop {oid} is not in outcrops.json")

    return report
