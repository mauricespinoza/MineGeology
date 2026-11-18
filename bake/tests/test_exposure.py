"""Work package 3: terrain, exposure, outcrop catalogue, dykes, validation report and scenario 1."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("gempy")

from geomapper_bake.bake import bake  # noqa: E402
from geomapper_bake.exposure import ALLUVIUM, BARE_ROCK, expose  # noqa: E402
from geomapper_bake.outcrops import build_dyke, striae  # noqa: E402
from geomapper_bake.scenario_format import validate_scenario  # noqa: E402
from geomapper_bake.terrain import fill_pits, flow_accumulation, procedural_terrain  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
SCENARIOS = Path(__file__).parent / "scenarios"


# --- terrain -----------------------------------------------------------------


def test_fill_pits_and_flow_accumulation():
    y, x = np.indices((30, 30)).astype(float)
    slope = 100.0 - 2.0 * x  # descends to the east
    pitted = slope.copy()
    pitted[10:13, 10:13] -= 30.0
    filled = fill_pits(pitted)
    assert (filled >= pitted).all()
    assert filled[11, 11] > filled[11, 14]  # the pit now drains east
    acc = flow_accumulation(slope)
    assert acc.min() == 1.0
    assert (acc[:, -1] > acc[:, 0]).all()
    assert acc.sum() > slope.size  # flow is passed on, not lost


def test_procedural_terrain_raises_resistant_rock_and_is_seeded():
    params = {"base_m": 500.0, "relief_m": 60.0, "noise_scale_m": 300.0, "resistance_relief_m": 120.0, "valley_depth_m": 40.0}

    def resistance(elev):
        hard = np.zeros(elev.shape)
        hard[:, elev.shape[1] // 2 :] = 1.0  # resistant rock in the eastern half
        return hard

    a = procedural_terrain((48, 48), 10.0, params, np.random.default_rng(5), resistance)
    b = procedural_terrain((48, 48), 10.0, params, np.random.default_rng(5), resistance)
    c = procedural_terrain((48, 48), 10.0, params, np.random.default_rng(6), resistance)
    assert (a == b).all() and not (a == c).all()
    assert a[:, 30:].mean() - a[:, :18].mean() > 60.0


# --- exposure ----------------------------------------------------------------


@pytest.fixture(scope="module")
def synthetic_exposure():
    rng = np.random.default_rng(11)
    y, x = np.indices((80, 80)).astype(float)
    elevation = 600.0 + 60.0 * np.sin(x / 9.0) * np.cos(y / 11.0) - 1.5 * x
    resistance = np.where(y > 40, 0.9, 0.2)
    return elevation, resistance, expose(elevation, 10.0, resistance, rng, {"target_fraction": 0.06})


def test_exposure_hits_its_target_and_labels_every_rock_cell(synthetic_exposure):
    _, _, result = synthetic_exposure
    assert result.fraction == pytest.approx(0.06, abs=0.002)
    rock = result.cover == BARE_ROCK
    assert (rock == (result.labels > 0)).all()
    assert not (rock & (result.cover == ALLUVIUM)).any()
    labels = np.unique(result.labels[rock])
    assert (labels == np.arange(1, len(labels) + 1)).all()
    # No outcrop sprawls beyond one tile.
    for n in labels:
        iy, ix = np.nonzero(result.labels == n)
        assert np.ptp(iy) < 6 and np.ptp(ix) < 6


def test_resistant_rock_is_better_exposed(synthetic_exposure):
    _, resistance, result = synthetic_exposure
    rock = result.labels > 0
    assert rock[resistance > 0.5].mean() > 1.3 * rock[resistance < 0.5].mean()
    assert rock[resistance < 0.5].any(), "weak rock must still crop out somewhere"


def test_environments_change_how_much_rock_shows_and_what_covers_the_rest():
    """Desert: rock nearly everywhere and almost no plants; forest: little rock and trees on most of the rest."""
    from geomapper_bake.exposure import VEGETATION

    y, x = np.indices((80, 80)).astype(float)
    elevation = 600.0 + 60.0 * np.sin(x / 9.0) * np.cos(y / 11.0) - 1.5 * x
    resistance = np.full((80, 80), 0.5)
    runs = {env: expose(elevation, 10.0, resistance, np.random.default_rng(3), None, None, env) for env in ("temperate", "desert", "forest")}
    assert runs["desert"].fraction > 0.3 > runs["temperate"].fraction > runs["forest"].fraction
    plants = {env: (r.cover == VEGETATION).mean() for env, r in runs.items()}
    assert plants["desert"] < 0.05 < plants["temperate"] < plants["forest"]
    assert plants["forest"] > 0.6


# --- rule-based structures ---------------------------------------------------


def test_striae_follow_the_kinematics():
    assert striae(10.0, 60.0, "normal") == {"kind": "striae", "trend": 100.0, "plunge": 60.0}
    assert striae(10.0, 60.0, "thrust")["plunge"] == 60.0
    assert striae(350.0, 80.0, "dextral") == {"kind": "striae", "trend": 350.0, "plunge": 0.0}
    oblique = striae(0.0, 90.0, "oblique")
    assert oblique["plunge"] == pytest.approx(45.0, abs=0.1)


def test_dyke_trace_follows_the_terrain():
    y, x = np.indices((60, 60)).astype(float)
    valley = 500.0 - 80.0 * np.exp(-(((y - 30.0) / 6.0) ** 2))  # an east-west valley 80 m deep
    spec = {"unit": "d", "through": [300.0, 300.0, 500.0], "strike": 0.0, "thickness_m": 5.0, "length_m": 500.0}

    vertical = build_dyke({**spec, "dip": 90.0}, valley, 10.0)
    assert np.allclose(vertical.trace[:, 0], 300.0)
    assert vertical.cells.sum() >= 45 and vertical.cells[:, 30].sum() == vertical.cells.sum()

    dipping = build_dyke({**spec, "dip": 45.0}, valley, 10.0)  # dips east
    # On the plateau the trace stays put; in the valley floor, 80 m lower, it moves 80 m down dip.
    assert dipping.trace[0, 0] == pytest.approx(300.0, abs=2.0)
    assert dipping.trace[:, 0].max() == pytest.approx(380.0, abs=6.0)


# --- outcrop catalogue through the bake --------------------------------------


@pytest.fixture(scope="module")
def homocline(tmp_path_factory):
    return bake(SCENARIOS / "homocline", tmp_path_factory.mktemp("homocline"), report=True)


def test_outcrops_show_the_true_geology(homocline):
    cfg = homocline.config
    grid = cfg["grid"]
    assert 0.03 <= (homocline.outcrop_labels > 0).mean() <= 0.08
    assert len(homocline.outcrops) > 5
    keys = [cfg["units"][n]["key"] for n in homocline.unit_names]
    for o in homocline.outcrops:
        obs = o["observation"]
        ix = int((o["position"]["easting"] - grid["origin"]["easting"]) / grid["cell_size_m"])
        iy = int((o["position"]["northing"] - grid["origin"]["northing"]) / grid["cell_size_m"])
        assert [ix, iy] in o["cells"]
        assert keys[homocline.true_map[iy, ix]] == obs["unit"]
        assert o["position"]["elevation"] == pytest.approx(homocline.elevation[iy, ix], abs=0.06)
        bedding = obs["planes"][0]
        assert bedding["kind"] == "bedding"
        assert bedding["strike"] == pytest.approx(cfg.params["strike"], abs=0.2)
        assert bedding["dip"] == pytest.approx(cfg.params["dip"], abs=0.2)
        assert obs["sampleable"] == (obs["quality"] != "poor")
        if "contact" in obs:
            assert obs["contact"]["type"] == "depositional"
            assert obs["contact"]["units"][0] == obs["unit"] and obs["contact"]["units"][1] != obs["unit"]
            assert o["id"] in homocline.truth["key_outcrops"]
    assert {o["observation"]["quality"] for o in homocline.outcrops} <= {"good", "fair", "poor"}


def test_report_is_written(homocline):
    page = (homocline.folder / "report.html").read_text(encoding="utf-8")
    assert "Informe de validación: Homoclinal de prueba" in page
    assert page.count("data:image/png;base64,") == 4
    assert "dentro del rango 3–8 %" in page
    assert validate_scenario(homocline.folder).errors == []  # the extra file does not disturb the scenario


def test_dykes_reach_the_outcrops_and_the_answer_key(tmp_path):
    folder = tmp_path / "s"
    shutil.copytree(SCENARIOS / "homocline", folder)
    text = (folder / "scenario.yaml").read_text(encoding="utf-8")
    text = text.replace(
        "\nevents:",
        """  dique:
    key: u05
    name: Dique de prueba
    age: {label: Cretácico Superior, from_ma: 95, to_ma: 90}
    rock_class: hypabyssal
    lithology: andesita afanítica
    colour: "#222222"
    texture: dyke_fine
    resistance: 0.9
    description:
      field: Roca negra de grano muy fino en un cuerpo tabular.
      hand_lens: Afanítica.

dykes:
  - {unit: dique, through: [160, 160, 1060], strike: 300, dip: 85, thickness_m: 5, length_m: 260}

exposure:
  weights: {dyke: 5}

events:""",
    )
    (folder / "scenario.yaml").write_text(text, encoding="utf-8")
    result = bake(folder, tmp_path / "out")

    (dyke,) = result.truth["dykes"]
    assert dyke["unit"] == "u05" and dyke["strike"] == 300 and dyke["dip"] == 85
    trace = np.array(dyke["trace"]["coordinates"])
    length = np.hypot(*(trace[-1] - trace[0]))
    assert 200 < length < 280
    assert "u05" in [u["key"] for u in json.loads((result.folder / "units.json").read_text(encoding="utf-8"))["units"]]
    assert (result.true_map != result.unit_names.index("dique")).all(), "a dyke is a line, not a map unit"

    showing = [o for o in result.outcrops if any(p["kind"] == "dyke" for p in o["observation"]["planes"])]
    assert len(showing) >= 3
    for o in showing:
        plane = next(p for p in o["observation"]["planes"] if p["kind"] == "dyke")
        assert (plane["strike"], plane["dip"]) == (300.0, 85.0)
        assert any("Dique de andesita afanítica" in f for f in o["observation"]["features"])
        assert o["id"] in result.truth["key_outcrops"]
        if o["observation"]["contact"]["type"] == "intrusive":
            assert o["observation"]["contact"]["units"][1] == "u05"
    assert any(o["observation"]["contact"]["type"] == "intrusive" for o in showing)


# --- scenario 1 ---------------------------------------------------------------


def test_quebrada_los_litres_bakes_as_designed(tmp_path):
    """A coarse draft of scenario 1: every unit on the map, beds dipping east, dykes, 3 to 8 % exposed."""
    result = bake(REPO / "scenarios" / "quebrada-los-litres", tmp_path, coarsen=8)
    assert validate_scenario(result.folder).errors == []
    manifest = json.loads((result.folder / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["grid"]["nx"] == 32 and manifest["grid"]["cell_size_m"]["x"] == 80
    assert 0.03 <= manifest["exposure_fraction"] <= 0.08

    on_map = {result.unit_names[i] for i in np.unique(result.true_map)}
    assert on_map == {"basement", "brechas", "marinas", "ocoitas", "capas_rojas"}
    # Beds young eastward: mean easting of each unit on the map follows the stratigraphy.
    x = np.indices(result.true_map.shape)[1]
    order = ["basement", "brechas", "marinas", "ocoitas", "capas_rojas"]
    eastings = [x[result.true_map == result.unit_names.index(n)].mean() for n in order]
    assert eastings == sorted(eastings)

    for o in result.outcrops:
        bedding = o["observation"]["planes"][0]
        assert bedding["strike"] > 335 or bedding["strike"] < 25  # dips east
        assert 24 < bedding["dip"] < 46
    assert [r["unit"] for r in result.truth["column"]] == ["u14", "u03", "u09", "u06", "u11"]
    assert len(result.truth["dykes"]) == 3
    assert {c["properties"]["type"] for c in result.truth["contacts"]["features"]} == {"depositional"}


# --- reference photos (format 1.2.0) -----------------------------------------------


def test_photos_are_baked_listed_and_replaceable(tmp_path):
    from PIL import Image

    from geomapper_bake.cli import main

    folder = tmp_path / "s"
    shutil.copytree(SCENARIOS / "homocline", folder)
    (folder / "photos").mkdir()
    Image.new("RGB", (40, 30), "#6b5b6e").save(folder / "photos" / "lava.jpg")
    text = (folder / "scenario.yaml").read_text(encoding="utf-8")
    text = text.replace(
        "    thin_section: Textura porfídica con plagioclasa zonada y clinopiroxeno.",
        "    thin_section: Textura porfídica con plagioclasa zonada y clinopiroxeno.\n"
        '    photos: [{kind: hand_sample, file: photos/lava.jpg, credit: "Autor", licence: "CC BY 4.0", source: "https://example.org/x"}]',
    )
    (folder / "scenario.yaml").write_text(text, encoding="utf-8")
    result = bake(folder, tmp_path / "out", coarsen=2)
    assert validate_scenario(result.folder).errors == []
    manifest = json.loads((result.folder / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["assets"] == [{"path": "photos/lava.jpg", "sha256": manifest["assets"][0]["sha256"], "bytes": (folder / "photos" / "lava.jpg").stat().st_size}]
    units = json.loads((result.folder / "units.json").read_text(encoding="utf-8"))["units"]
    lava = next(u for u in units if u["key"] == "u07")
    assert lava["photos"] == [{"kind": "hand_sample", "path": "photos/lava.jpg", "credit": "Autor", "licence": "CC BY 4.0", "source": "https://example.org/x"}]
    assert all("photos" not in u for u in units if u["key"] != "u07")

    # A tampered photo fails its hash.
    (result.folder / "photos" / "lava.jpg").write_bytes(b"not a photo")
    assert any("lava.jpg" in e for e in validate_scenario(result.folder).errors)

    # `geomapper photos` replaces them on a finished bake, and publish copies them.
    Image.new("RGB", (40, 30), "#c8b560").save(folder / "photos" / "lava.jpg")
    assert main(["photos", str(folder), str(result.folder)]) == 0
    assert validate_scenario(result.folder).errors == []
    assert main(["publish", str(result.folder), str(tmp_path / "public")]) == 0
    assert (tmp_path / "public" / "photos" / "lava.jpg").read_bytes() == (folder / "photos" / "lava.jpg").read_bytes()
    assert validate_scenario(tmp_path / "public", require_all=False).errors == []
