"""Work package 1: the toy scenario validates, and broken scenarios are caught."""

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import math
import shutil
import struct
from pathlib import Path

import pytest

from geomapper_bake.cli import main
from geomapper_bake.scenario_format import (
    FormatError,
    decode_rle8,
    decode_u16le,
    encode_rle8,
    validate_scenario,
)

REPO = Path(__file__).resolve().parents[2]
TOY = REPO / "format" / "examples" / "toy"


@pytest.fixture
def toy(tmp_path: Path) -> Path:
    target = tmp_path / "toy"
    shutil.copytree(TOY, target)
    return target


def rewrite(folder: Path, role: str, data: bytes) -> None:
    """Replace a file and keep the manifest's hash and size in step."""
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    entry = manifest["files"][role]
    (folder / entry["path"]).write_bytes(data)
    entry["sha256"] = hashlib.sha256(data).hexdigest()
    entry["bytes"] = len(data)
    (folder / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def edit_json(folder: Path, role: str, change) -> None:
    doc = json.loads((folder / f"{role}.json").read_text(encoding="utf-8"))
    change(doc)
    rewrite(folder, role, json.dumps(doc).encode("utf-8"))


def test_toy_scenario_is_valid():
    report = validate_scenario(TOY)
    assert report.errors == []
    assert set(report.checked) == {"manifest", "terrain", "cover", "outcrops", "units", "litho", "orient", "truth"}


def test_committed_toy_matches_its_generator(tmp_path: Path):
    """Compares content, not compressed bytes: deflate output may vary between zlib builds."""
    spec = importlib.util.spec_from_file_location("make_toy", REPO / "format" / "examples" / "make_toy.py")
    make_toy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(make_toy)
    make_toy.build(tmp_path / "toy")
    assert validate_scenario(tmp_path / "toy").errors == []

    def content(path: Path):
        data = path.read_bytes()
        if path.suffix == ".bin":
            return gzip.decompress(data)
        doc = json.loads(data)
        if path.name == "manifest.json":
            for entry in doc["files"].values():
                del entry["sha256"], entry["bytes"]
        return doc

    for path in sorted(TOY.iterdir()):
        assert content(tmp_path / "toy" / path.name) == content(path), path.name


def test_toy_geology_is_consistent():
    """The stored pole, the lithology block and the true map describe the same homocline."""
    manifest = json.loads((TOY / "manifest.json").read_text(encoding="utf-8"))
    grid = manifest["grid"]
    nx, ny, nz = grid["nx"], grid["ny"], grid["nz"]

    pole = struct.unpack("<3b", gzip.decompress((TOY / "orient.bin").read_bytes())[:3])
    dip = math.degrees(math.acos(pole[2] / math.hypot(*pole)))
    dip_direction = math.degrees(math.atan2(pole[0], pole[1])) % 360
    assert dip == pytest.approx(30, abs=1)
    assert dip_direction == pytest.approx(90, abs=1)

    litho = decode_rle8((TOY / "litho.bin").read_bytes())
    terrain = decode_u16le((TOY / "terrain.bin").read_bytes())
    truth = json.loads((TOY / "truth.json").read_text(encoding="utf-8"))
    true_map = [index for index, run in truth["map"]["runs"] for _ in range(run)]
    t = manifest["terrain"]
    disagree = 0
    for i, value in enumerate(terrain):
        z = t["offset_m"] + value * t["scale_m"] - grid["origin"]["elevation"]
        iz = min(int(z / grid["cell_size_m"]["z"]), nz - 1)
        disagree += litho[i + nx * ny * iz] != true_map[i]
    # The block is sampled at cell centres and the map at the exact surface, so a
    # few cells next to a contact may differ; anything more means a real mismatch.
    assert disagree <= 0.1 * nx * ny

    # East-dipping and upright: units young eastward along every row.
    for iy in range(ny):
        row = true_map[iy * nx : (iy + 1) * nx]
        assert row == sorted(row)


def test_rle_round_trip():
    values = bytes([3]) * 70000 + bytes([0, 1, 1, 2])
    assert decode_rle8(encode_rle8(values)) == values


def test_newer_major_version_is_refused(toy: Path):
    manifest = json.loads((toy / "manifest.json").read_text(encoding="utf-8"))
    manifest["format_version"] = "2.0.0"
    (toy / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(FormatError, match="newer than the supported major version"):
        validate_scenario(toy)


def test_tampered_file_fails_its_hash(toy: Path):
    path = toy / "units.json"
    path.write_bytes(path.read_bytes().replace(b"andesita", b"dacitaaa"))
    assert any("sha256" in e for e in validate_scenario(toy).errors)


def test_outcrop_under_soil_is_rejected(toy: Path):
    cover = bytearray(gzip.decompress((toy / "cover.bin").read_bytes()))
    nx = json.loads((toy / "manifest.json").read_text(encoding="utf-8"))["grid"]["nx"]
    cover[1 + nx * 3] = 1
    rewrite(toy, "cover", gzip.compress(bytes(cover), mtime=0))
    assert any("o001" in e and "not bare rock" in e for e in validate_scenario(toy).errors)


def test_wrong_grid_size_is_rejected(toy: Path):
    rewrite(toy, "terrain", gzip.compress(struct.pack("<4H", 300, 300, 300, 300), mtime=0))
    assert any("grid needs 256" in e for e in validate_scenario(toy).errors)


def test_unknown_unit_reference_is_rejected(toy: Path):
    edit_json(toy, "outcrops", lambda d: d["outcrops"][0]["observation"].update(unit="u99"))
    assert any("unknown unit u99" in e for e in validate_scenario(toy).errors)


def test_schema_violation_is_reported(toy: Path):
    edit_json(toy, "outcrops", lambda d: d["outcrops"][0]["observation"]["planes"][0].update(dip=120))
    assert any("120" in e for e in validate_scenario(toy).errors)


def test_truth_must_match_units(toy: Path):
    edit_json(toy, "truth", lambda d: d["units"].reverse())
    assert any("differ from units.json" in e for e in validate_scenario(toy).errors)


def test_public_bundle_and_graded_outcrops(toy: Path):
    """A bundle without the answer key, with observations stripped, is still valid."""
    for name in ("truth.json", "litho.bin", "orient.bin"):
        (toy / name).unlink()

    def strip(doc):
        for outcrop in doc["outcrops"]:
            del outcrop["observation"]

    edit_json(toy, "outcrops", strip)
    assert not validate_scenario(toy).ok
    report = validate_scenario(toy, require_all=False)
    assert report.errors == []
    assert set(report.skipped) == {"truth", "litho", "orient"}


def test_publish_leaves_the_answer_key_behind(toy: Path, tmp_path: Path):
    from geomapper_bake.scenario_format import deobfuscate

    public = tmp_path / "public"
    assert main(["publish", str(toy), str(public)]) == 0
    assert sorted(p.name for p in public.iterdir()) == ["cover.bin", "manifest.json", "outcrops.json", "terrain.bin", "units.json"]
    assert validate_scenario(public, require_all=False).errors == []

    # Practice mode adds the answer key, obfuscated: readable by the game, not at a glance.
    assert main(["publish", "--practice", str(toy), str(public)]) == 0
    litho = json.loads((toy / "manifest.json").read_text(encoding="utf-8"))["files"]["litho"]
    assert deobfuscate((public / "practice-litho.bin").read_bytes(), litho["sha256"]) == (toy / "litho.bin").read_bytes()
    packed = (public / "practice.bin").read_bytes()
    truth = (toy / "truth.json").read_bytes()
    assert b"Lavas Los Peumos" not in packed and packed[:2] != b"\x1f\x8b"
    sha = json.loads((toy / "manifest.json").read_text(encoding="utf-8"))["files"]["truth"]["sha256"]
    assert deobfuscate(packed, sha) == truth
    # Publishing again without it removes it.
    assert main(["publish", str(toy), str(public)]) == 0
    assert not (public / "practice.bin").exists() and not (public / "practice-litho.bin").exists()


def test_cli(toy: Path, capsys):
    assert main(["validate", str(toy)]) == 0
    assert "valid" in capsys.readouterr().out
    (toy / "cover.bin").unlink()
    assert main(["validate", str(toy)]) == 1
