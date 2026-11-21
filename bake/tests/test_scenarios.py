"""Coarse drafts of scenarios 2 to 4: each bakes into a valid scenario with the structures it was designed for."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("gempy")

from geomapper_bake.bake import bake  # noqa: E402
from geomapper_bake.scenario_format import validate_scenario  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def contact_types(result) -> set[str]:
    return {f["properties"]["type"] for f in result.truth["contacts"]["features"]}


def planes(result, kind: str) -> list[dict]:
    return [p for o in result.outcrops for p in o["observation"]["planes"] if p["kind"] == kind]


def test_cerro_pizarras_has_an_aureole_foliation_and_an_unconformity(tmp_path):
    result = bake(REPO / "scenarios" / "cerro-pizarras", tmp_path, coarsen=4)
    assert validate_scenario(result.folder).errors == []
    names = result.unit_names
    on_map = {names[i] for i in np.unique(result.true_map)}
    assert on_map == {"basement", "pizarras", "corneanas", "granodiorita", "conglomerados", "areniscas"}
    assert contact_types(result) >= {"intrusive", "gradational", "unconformity", "depositional"}

    # The hornfels wraps the stock and never touches the Triassic cover's inside.
    stock = result.litho == names.index("granodiorita")
    hornfels = result.litho == names.index("corneanas")
    from scipy import ndimage

    assert (hornfels & ~ndimage.binary_dilation(stock, iterations=8)).sum() == 0, "hornfels only near the stock"
    assert hornfels.sum() > 0.1 * stock.sum()
    cover = np.isin(result.litho, [names.index("conglomerados"), names.index("areniscas")])
    assert not (cover & hornfels).any()

    # The basement shows foliation, the cover bedding; the column leaves the stock out.
    assert planes(result, "foliation") and planes(result, "bedding")
    for o in result.outcrops:
        kinds = {p["kind"] for p in o["observation"]["planes"]}
        unit = next(n for n in names if result.config["units"][n]["key"] == o["observation"]["unit"])
        if unit in ("basement", "pizarras", "corneanas"):
            assert "bedding" not in kinds
    keys = [r["unit"] for r in result.truth["column"]]
    assert keys == ["u21", "u09", "u12", "u18"]
    manifest = json.loads((result.folder / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["environment"] == "forest" and manifest["exposure_fraction"] < 0.04, "a forest shows little rock"
    assert [r["base_contact"] for r in result.truth["column"]] == ["not_exposed", "depositional", "unconformity", "depositional"]


def test_valle_del_yeso_blanco_has_folds_an_overturned_limb_and_a_thrust(tmp_path):
    result = bake(REPO / "scenarios" / "valle-del-yeso-blanco", tmp_path, coarsen=4)
    assert validate_scenario(result.folder).errors == []
    assert contact_types(result) == {"depositional", "fault"}
    bedding = planes(result, "bedding")
    assert any(p.get("overturned") for p in bedding), "the common limb is overturned"
    assert sum(p.get("overturned", False) for p in bedding) < len(bedding) / 2
    kinds = Counter(a["type"] for a in result.truth["fold_axes"])
    assert kinds["anticline"] >= 1 and kinds["syncline"] >= 1
    for axis in result.truth["fold_axes"]:
        assert axis["trend"] == 0.0 and axis["plunge"] == 8.0
    on_fault = [o for o in result.outcrops if any(p["kind"] == "fault_plane" for p in o["observation"]["planes"])]
    indicators = [o["observation"]["kinematic"] for o in on_fault if "kinematic" in o["observation"]]
    assert bool(indicators) == bool(on_fault)
    assert all(k["sense"] == "reverse" for k in indicators)


def test_estero_las_tobas_is_an_inverted_half_graben_sealed_by_a_stock(tmp_path):
    result = bake(REPO / "scenarios" / "estero-las-tobas", tmp_path, coarsen=2)
    assert validate_scenario(result.folder).errors == []
    names = result.unit_names
    assert contact_types(result) == {"depositional", "fault", "intrusive"}
    grid = result.config["grid"]
    d = grid["cell_size_m"] * 2
    model = result.config.folder / "model.py"
    assert model.exists()

    # Thickening toward the fault: the tuffs are thicker in the hanging wall near the fault than far from it.
    nz, ny, nx = result.litho.shape
    tobas = result.litho == names.index("tobas")
    thickness = tobas.sum(axis=0) * d  # metres, per column (cells are as tall as they are wide here)
    row = ny // 2
    near = thickness[row, int(1350 / d)]
    far = thickness[row, int(2400 / d)]
    footwall = thickness[row, int(500 / d)]
    assert near > far > footwall > 0

    # The stock is not offset: no fault trace crosses it.
    stock = result.true_map == names.index("granodiorita")
    assert stock.any()
    origin = grid["origin"]
    for f in result.truth["contacts"]["features"]:
        if f["properties"]["type"] == "fault":
            for e, n in f["geometry"]["coordinates"]:
                i, j = int((n - origin["northing"]) / d), int((e - origin["easting"]) / d)
                assert not stock[min(i, ny - 1), min(j, nx - 1)]
    # Whether a coarse draft has an outcrop on the fault is luck; where it has, the indicator is there.
    on_fault = [o for o in result.outcrops if any(p["kind"] == "fault_plane" for p in o["observation"]["planes"])]
    indicators = [o["observation"]["kinematic"] for o in on_fault if "kinematic" in o["observation"]]
    assert bool(indicators) == bool(on_fault)
    assert all(k["sense"] == "reverse" and k["indicator"] in {"steps", "riedel", "drag"} for k in indicators)
    assert {f["properties"].get("kinematics") for f in result.truth["contacts"]["features"] if f["properties"]["type"] == "fault"} == {"reverse"}
    manifest = json.loads((result.folder / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["summary"].startswith("Desierto")
    assert manifest["environment"] == "desert"
    assert manifest["exposure_fraction"] > 0.3, "in a desert the rock shows nearly everywhere"


def test_cerro_amarillo_has_porphyry_alteration_zoned_and_channelled_by_faults(tmp_path):
    result = bake(REPO / "scenarios" / "cerro-amarillo", tmp_path, coarsen=2)  # coarser drafts smooth away the cap's peaks
    assert validate_scenario(result.folder).errors == []
    cfg, names = result.config, result.unit_names
    zones = cfg["alteration"]["zones"]
    order = sorted(zones, key=lambda n: zones[n]["key"])
    alt = result.alteration_map
    assert set(np.unique(alt)) == set(range(len(order) + 1)), "every zone and unaltered rock reach the surface"

    # The shells: potassic nearest the porphyry, then phyllic, then propylitic; the advanced argillic cap stands high.
    d = cfg["grid"]["cell_size_m"] * 2
    ny, nx = alt.shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    centre = np.argwhere(result.true_map == names.index("porfido")).mean(axis=0)
    dist = np.hypot(yy - centre[0], xx - centre[1]) * d
    mean = {n: dist[alt == order.index(n) + 1].mean() for n in order}
    assert mean["potasica"] < mean["filica"] < mean["propilitica"]
    assert dist[alt == order.index("potasica") + 1].max() < 600
    cap = result.elevation[alt == order.index("argilica_avanzada") + 1].min()
    assert cap > np.median(result.elevation)

    # Structural control: phyllic alteration follows the transverse fault well beyond the porphyry's shell.
    far_phyllic = (alt == order.index("filica") + 1) & (dist > 600)
    assert far_phyllic.sum() > 20

    # Alteration overprints the rock: altered outcrops keep their unit, and the zone is the cells' majority.
    altered = [o for o in result.outcrops if "alteration" in o["observation"]]
    assert len(altered) > 0.3 * len(result.outcrops)
    units_altered = {o["observation"]["unit"] for o in altered}
    assert len(units_altered) >= 4, "several rock units carry the same alteration"
    for o in altered[:50]:
        ix, iy = np.array(o["cells"]).T
        values, counts = np.unique(alt[iy, ix], return_counts=True)
        assert zones[order[values[np.argmax(counts)] - 1]]["key"] == o["observation"]["alteration"]["key"]

    # Veins in the phyllic zone strike north-west, parallel to the transverse fault.
    phyllic_key = zones["filica"]["key"]
    strikes = [p["strike"] for o in altered if o["observation"]["alteration"]["key"] == phyllic_key for p in o["observation"]["planes"] if p["kind"] == "vein"]
    assert len(strikes) >= 5
    assert all(min(abs(s - 315) % 360, 360 - abs(s - 315) % 360) < 45 for s in strikes)

    # The public files describe the zones without naming them; the answer key names them.
    public = (result.folder / "units.json").read_text(encoding="utf-8")
    assert "Alteración" not in public and "potásica" not in public.lower()
    doc = json.loads(public)
    assert [a["key"] for a in doc["alterations"]] == [z["key"] for z in result.truth["alteration"]["zones"]]
    assert {z["type"] for z in result.truth["alteration"]["zones"]} == {"potassic", "phyllic", "advanced_argillic", "propylitic"}
    assert contact_types(result) >= {"intrusive", "fault", "depositional"}
