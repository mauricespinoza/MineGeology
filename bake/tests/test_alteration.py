"""The alteration layer: zones by priority, regions by distance, elevation and host, and the files it writes."""

from __future__ import annotations

import numpy as np

from geomapper_bake.alteration import evaluate, intensity


class Cfg(dict):
    seed = 3


def block_with_body():
    """A 20 x 20 x 10 block of 10 m cells: rock 0 everywhere, rock 1 below 50 m, a body (2) in the middle."""
    nz, ny, nx = 10, 20, 20
    block = np.zeros((nz, ny, nx), dtype=np.uint8)
    block[:5] = 1
    block[:, 8:12, 8:12] = 2
    return block


def surface_points(z: float):
    y, x = np.mgrid[0:20, 0:20]
    return np.column_stack([(x.ravel() + 0.5) * 10, (y.ravel() + 0.5) * 10, np.full(400, z)])


def zone(key, where, **extra):
    return {"key": key, "name": key, "type": "other", "colour": "#ffffff", "minerals": ["x"], "description": {"field": "f", "hand_lens": "h"}, "where": where, **extra}


def test_shells_take_the_first_zone_that_holds_a_point():
    block = block_with_body()
    points = surface_points(75.0)
    unit = block[7].ravel()
    cfg = Cfg(alteration={"zones": {"core": zone("a05", [{"within_m": {"body": 15}}]), "halo": zone("a01", [{"within_m": {"body": 60}}])}})
    out = evaluate(cfg, ["host", "lower", "body"], block, {}, points, unit, 0.0, 10.0, 10.0)
    value = out.value.reshape(20, 20)
    assert out.zone_names == ["halo", "core"], "files list zones by key"
    core, halo = out.zone_names.index("core") + 1, out.zone_names.index("halo") + 1
    assert (value[8:12, 8:12] == core).all(), "the body itself is in the core zone"
    assert value[10, 3] == halo and value[0, 0] == 0
    assert (out.score[out.value == core] > 0).all()


def test_hosts_and_elevation_limit_a_zone():
    block = block_with_body()
    cfg = Cfg(alteration={"zones": {"manto": zone("a02", [{"within_m": {"body": 80}, "below_m": 60}], hosts=["lower"])}})
    high = evaluate(cfg, ["host", "lower", "body"], block, {}, surface_points(75.0), block[7].ravel(), 0.0, 10.0, 10.0)
    assert not high.value.any(), "above the limit, and in the wrong host"
    low = evaluate(cfg, ["host", "lower", "body"], block, {}, surface_points(35.0), block[3].ravel(), 0.0, 10.0, 10.0)
    value = low.value.reshape(20, 20)
    assert value[10, 4] == 1, "the permeable host near the body is altered"
    assert value[10, 10] == 0, "the body is not a host"


def test_distance_to_a_fault_channels_a_zone():
    block = np.zeros((10, 20, 20), dtype=np.uint8)
    side = np.zeros(block.shape, dtype=bool)
    side[:, :, 10:] = True  # a vertical fault between x = 100 and 110 m
    cfg = Cfg(alteration={"zones": {"along": zone("a04", [{"within_m": {"fault": 25}}])}})
    out = evaluate(cfg, ["host"], block, {"fault": side}, surface_points(55.0), block[5].ravel(), 0.0, 10.0, 10.0)
    row = out.value.reshape(20, 20)[10]
    assert row[9] == 1 and row[10] == 1 and row[7] == 1
    assert row[2] == 0 and row[17] == 0


def test_intensity_grows_inward():
    assert [intensity(s) for s in (0.05, 0.3, 0.8)] == ["weak", "moderate", "strong"]


def test_the_validator_checks_alteration_across_files(tmp_path):
    import hashlib
    import json
    from pathlib import Path

    from geomapper_bake.bake import bake
    from geomapper_bake.scenario_format import validate_scenario

    result = bake(Path(__file__).resolve().parents[2] / "scenarios" / "cerro-amarillo", tmp_path, coarsen=4)
    assert validate_scenario(result.folder).errors == []

    def rewrite(name, change):
        path = result.folder / f"{name}.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        change(doc)
        data = json.dumps(doc).encode()
        path.write_bytes(data)
        manifest = json.loads((result.folder / "manifest.json").read_text(encoding="utf-8"))
        manifest["files"][name].update(sha256=hashlib.sha256(data).hexdigest(), bytes=len(data))
        (result.folder / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    def stray_key(doc):
        next(o for o in doc["outcrops"] if "alteration" in o["observation"])["observation"]["alteration"]["key"] = "a99"

    rewrite("outcrops", stray_key)
    rewrite("truth", lambda doc: doc["alteration"]["zones"].reverse())
    errors = "\n".join(validate_scenario(result.folder).errors)
    assert "unknown alteration a99" in errors
    assert "alteration zones differ from units.json" in errors
