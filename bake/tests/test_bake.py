"""Work package 2: the baked block, bedding field, true map and traces match the model that was authored."""

from __future__ import annotations

import gzip
import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("gempy")

from geomapper_bake.authoring import pole_from_strike_dip, strike_dip_from_pole  # noqa: E402
from geomapper_bake.bake import bake  # noqa: E402
from geomapper_bake.scenario_config import ConfigError, load_config  # noqa: E402
from geomapper_bake.scenario_format import decode_rle8, validate_scenario  # noqa: E402

SCENARIOS = Path(__file__).parent / "scenarios"


def load_model(name: str):
    spec = importlib.util.spec_from_file_location(f"model_{name}", SCENARIOS / name / "model.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def angle_to(poles: np.ndarray, reference: np.ndarray) -> np.ndarray:
    """Angle in degrees between stored int8 poles (n, 3) and a unit vector."""
    p = poles.astype(float)
    cos = (p @ reference) / np.linalg.norm(p, axis=1)
    return np.degrees(np.arccos(np.clip(cos, -1.0, 1.0)))


def cell_centres(result):
    grid = result.config["grid"]
    d = grid["cell_size_m"]
    x = (np.arange(grid["nx"]) + 0.5) * d
    y = (np.arange(grid["ny"]) + 0.5) * d
    z = grid["origin"]["elevation"] + (np.arange(grid["nz"]) + 0.5) * grid.get("cell_height_m", d)
    return x, y, z


def trace_points(result, kind: str) -> list[np.ndarray]:
    """Traces of one type, in model coordinates (metres from the south-west corner)."""
    origin = result.config["grid"]["origin"]
    return [
        np.array(f["geometry"]["coordinates"]) - [origin["easting"], origin["northing"]]
        for f in result.truth["contacts"]["features"]
        if f["properties"]["type"] == kind
    ]


def densify(line: np.ndarray, step: float = 2.0) -> np.ndarray:
    out = [line[:1]]
    for a, b in zip(line[:-1], line[1:]):
        n = max(int(np.hypot(*(b - a)) / step), 1)
        out.append(a + (b - a) * np.linspace(0, 1, n + 1)[1:, None])
    return np.vstack(out)


# --- homocline -------------------------------------------------------------


@pytest.fixture(scope="module")
def homocline(tmp_path_factory):
    return bake(SCENARIOS / "homocline", tmp_path_factory.mktemp("homocline"))


def homocline_height(model, cfg, x, y, z):
    """Stratigraphic height above the block centre, from the authored strike and dip."""
    grid = cfg["grid"]
    centre = np.array(
        [grid["nx"] * grid["cell_size_m"] / 2, grid["ny"] * grid["cell_size_m"] / 2,
         grid["origin"]["elevation"] + grid["nz"] * grid["cell_size_m"] / 2]
    )
    pole = pole_from_strike_dip(cfg.params["strike"], cfg.params["dip"])
    return (x - centre[0]) * pole[0] + (y - centre[1]) * pole[1] + (z - centre[2]) * pole[2]


def test_bedding_matches_input_within_one_degree_at_every_cell(homocline):
    """The done-when test of work package 2."""
    cfg = homocline.config
    reference = pole_from_strike_dip(cfg.params["strike"], cfg.params["dip"])
    poles = homocline.poles["s01"].reshape(-1, 3)
    assert poles.any(axis=1).all(), "a single series fills the block: no cell may be masked"
    assert angle_to(poles, reference).max() < 1.0

    strike, dip, overturned = strike_dip_from_pole(poles[0])
    assert strike == pytest.approx(cfg.params["strike"], abs=1.0)
    assert dip == pytest.approx(cfg.params["dip"], abs=1.0)
    assert not overturned


def test_homocline_block_and_map_match_the_authored_planes(homocline):
    model = load_model("homocline")
    cfg = homocline.config
    names = np.array(homocline.unit_names)
    x, y, z = cell_centres(homocline)

    def expected(height):
        out = np.full(height.shape, "basement", dtype=object)
        out[height >= model.BASES["brechas"]] = "brechas"
        out[height >= model.BASES["areniscas"]] = "areniscas"
        return out

    zz, yy, xx = np.meshgrid(z, y, x, indexing="ij")
    assert (names[homocline.litho] == expected(homocline_height(model, cfg, xx, yy, zz))).all()
    yy, xx = np.meshgrid(y, x, indexing="ij")
    surface = homocline_height(model, cfg, xx, yy, homocline.elevation)
    assert (names[homocline.true_map] == expected(surface)).all()
    assert set(names[homocline.true_map].ravel()) == {"basement", "brechas", "areniscas"}


def test_homocline_contacts_follow_the_true_contacts(homocline):
    from scipy import ndimage

    model = load_model("homocline")
    cfg = homocline.config
    d = cfg["grid"]["cell_size_m"]
    lines = trace_points(homocline, "depositional")
    assert len(lines) == 2
    assert trace_points(homocline, "fault") == [] and trace_points(homocline, "unconformity") == []

    keys = {cfg["units"][n]["key"]: n for n in cfg["units"]}
    for feature, line in zip(homocline.truth["contacts"]["features"], lines):
        pair = {keys[k] for k in feature["properties"]["units"]}
        base = model.BASES["areniscas"] if "areniscas" in pair else model.BASES["brechas"]
        assert "brechas" in pair
        pts = densify(line)
        elev = ndimage.map_coordinates(homocline.elevation, [pts[:, 1] / d - 0.5, pts[:, 0] / d - 0.5], order=1, mode="nearest")
        # Distance from the bed, measured across bedding; the map distance is about twice that at this dip.
        off = np.abs(homocline_height(model, cfg, pts[:, 0], pts[:, 1], elev) - base)
        assert off.max() < 0.35 * d
        # Each contact crosses the whole area from south to north.
        assert np.ptp(pts[:, 1]) > 0.95 * cfg["grid"]["ny"] * d


def test_bake_writes_a_valid_scenario(homocline):
    report = validate_scenario(homocline.folder)
    assert report.errors == []
    manifest = json.loads((homocline.folder / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["series"] == [{"key": "s01", "kind": "volcanic"}]
    assert manifest["format_version"] == "1.6.0"

    units = json.loads((homocline.folder / "units.json").read_text(encoding="utf-8"))["units"]
    assert [u["key"] for u in units] == sorted(u["key"] for u in units)
    assert all("name" not in u and "age" not in u and "lab_age" not in u for u in units)

    truth = json.loads((homocline.folder / "truth.json").read_text(encoding="utf-8"))
    assert [row["unit"] for row in truth["column"]] == ["u07", "u02", "u11"]  # oldest first
    assert [row["base_contact"] for row in truth["column"]] == ["not_exposed", "depositional", "depositional"]
    assert truth["events"][0] == {"id": "e01", "type": "deposition", "rank": 1, "label": "Efusión de lavas andesíticas", "units": ["u07"]}

    grid = manifest["grid"]
    litho = np.frombuffer(decode_rle8((homocline.folder / "litho.bin").read_bytes()), dtype=np.uint8)
    assert (litho.reshape(grid["nz"], grid["ny"], grid["nx"]) == homocline.litho).all()


def test_bake_is_deterministic(homocline, tmp_path):
    again = bake(SCENARIOS / "homocline", tmp_path)
    for path in sorted(homocline.folder.iterdir()):
        a, b = path.read_bytes(), (again.folder / path.name).read_bytes()
        if path.suffix == ".bin":
            a, b = gzip.decompress(a), gzip.decompress(b)
        assert a == b, path.name


def test_variant_changes_the_dip(tmp_path):
    result = bake(SCENARIOS / "homocline", tmp_path, variant="b")
    assert result.config.params == {"strike": 20, "dip": 60}
    _, dip, _ = strike_dip_from_pole(result.poles["s01"][0, 0, 0])
    assert dip == pytest.approx(60, abs=1.0)
    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["variant"] == "b"


# --- reverse fault sealed by a flat cover -----------------------------------


@pytest.fixture(scope="module")
def faulted(tmp_path_factory):
    return bake(SCENARIOS / "faulted_cover", tmp_path_factory.mktemp("faulted"))


def faulted_expected(model, x, y, z):
    height = model.bed_height(x, z)
    out = np.full(np.shape(height), "basement", dtype=object)
    out[height >= model.BASES["a"]] = "a"
    out[height >= model.BASES["b"]] = "b"
    out[np.broadcast_to(z, out.shape) > model.COVER_BASE] = "ignimbrita"
    return out


def test_fault_offsets_the_units_and_the_cover_seals_it(faulted):
    model = load_model("faulted_cover")
    names = np.array(faulted.unit_names)
    x, y, z = cell_centres(faulted)
    zz, yy, xx = np.meshgrid(z, y, x, indexing="ij")
    got = names[faulted.litho]
    assert (got == faulted_expected(model, xx, yy, zz)).mean() > 0.995

    # The same bed sits THROW higher east of the fault: compare the top of unit "a" in two columns.
    def top_of_a(ix):
        column = got[:, 5, ix]
        return z[np.flatnonzero(column == "a").max()]

    west, east = 10, 28  # columns well away from the fault, x = 210 m and 570 m
    dip_drop = (x[east] - x[west]) * np.tan(np.radians(20.0))
    assert top_of_a(east) - top_of_a(west) + dip_drop == pytest.approx(model.THROW, abs=faulted.config["grid"]["cell_size_m"])

    # The cover is one flat sheet: no step where the fault passes below it.
    cover = got == "ignimbrita"
    assert (cover == (zz > model.COVER_BASE)).all()


def test_bedding_per_series_in_a_faulted_model(faulted):
    model = load_model("faulted_cover")
    names = np.array(faulted.unit_names)
    in_cover = (names[faulted.litho] == "ignimbrita").ravel()
    strata = faulted.poles["s01"].reshape(-1, 3)
    cover = faulted.poles["s02"].reshape(-1, 3)

    # Each series stores poles only in its own rocks.
    assert (strata.any(axis=1) == ~in_cover).all()
    assert (cover.any(axis=1) == in_cover).all()
    # Beds keep their 20 degree dip on both sides of the fault, right up to it.
    assert angle_to(strata[~in_cover], model.BED_POLE).max() < 1.0
    assert angle_to(cover[in_cover], np.array([0.0, 0.0, 1.0])).max() < 1.0


def test_contact_types_and_fault_trace(faulted):
    model = load_model("faulted_cover")
    d = faulted.config["grid"]["cell_size_m"]
    features = faulted.truth["contacts"]["features"]
    assert {f["properties"]["type"] for f in features} == {"depositional", "unconformity", "fault"}
    faults = [f for f in features if f["properties"]["type"] == "fault"]
    assert all(f["properties"]["kinematics"] == "reverse" and "units" not in f["properties"] for f in faults)

    # Every contact with the cover is an unconformity, and nothing else is.
    for f in features:
        if f["properties"]["type"] != "fault":
            assert ("u04" in f["properties"]["units"]) == (f["properties"]["type"] == "unconformity")

    cot = model.FAULT_POLE[2] / model.FAULT_POLE[0]
    covered = 0
    for line in trace_points(faulted, "fault"):
        pts = densify(line)
        elev = model.build_terrain(pts[:, 0], pts[:, 1], None)
        true_x = model.FAULT_THROUGH[0] - (elev - model.FAULT_THROUGH[2]) * cot
        assert np.abs(pts[:, 0] - true_x).max() < 0.5 * d
        covered += (elev > model.COVER_BASE + 1.0).sum()
    assert covered == 0, "the fault trace must stop where the cover seals it"

    # The fault is mapped wherever it reaches the surface outside the cover.
    y = (np.arange(faulted.config["grid"]["ny"]) + 0.5) * d
    exposed = model.build_terrain(0.0, y, None) < model.COVER_BASE - 2.0
    traced = np.concatenate([densify(line)[:, 1] for line in trace_points(faulted, "fault")])
    assert all(np.abs(traced - row).min() < d for row in y[exposed])


def test_mask_buffer_hides_bedding_next_to_discontinuities(faulted, tmp_path):
    folder = copy_scenario("faulted_cover", tmp_path / "s")
    with (folder / "scenario.yaml").open("a", encoding="utf-8") as f:
        f.write("\nbake: {mask_buffer_cells: 1}\n")
    buffered = bake(folder, tmp_path / "out")
    for key in ("s01", "s02"):
        kept = buffered.poles[key].any(axis=3)
        before = faulted.poles[key].any(axis=3)
        assert (kept <= before).all() and kept.sum() < before.sum()
        assert (buffered.poles[key][kept] == faulted.poles[key][kept]).all()

    # Cells on either side of the cover base and of the fault lose their pole; cells away from both keep it.
    model = load_model("faulted_cover")
    x, y, z = cell_centres(buffered)
    strata = buffered.poles["s01"].any(axis=3)
    below_cover = np.flatnonzero(z < model.COVER_BASE).max()
    assert not strata[below_cover].any()
    assert strata[below_cover - 1].any()
    iz = 3
    east = model.east_of_fault(x, z[iz])
    last_west = np.flatnonzero(~east).max()
    assert not strata[iz, 5, last_west] and not strata[iz, 5, last_west + 1]
    assert strata[iz, 5, last_west - 1] and strata[iz, 5, last_west + 2]


# --- configuration errors ----------------------------------------------------


def copy_scenario(name: str, target: Path) -> Path:
    import shutil

    shutil.copytree(SCENARIOS / name, target)
    return target


def test_unit_missing_from_yaml_is_reported(tmp_path):
    folder = copy_scenario("homocline", tmp_path / "s")
    text = (folder / "scenario.yaml").read_text(encoding="utf-8")
    (folder / "scenario.yaml").write_text(text.replace("  brechas:", "  tobas:").replace("[brechas]", "[tobas]"), encoding="utf-8")
    with pytest.raises(ConfigError, match="units in model.py but not in scenario.yaml: brechas"):
        bake(folder, tmp_path / "out")


def test_terrain_outside_the_block_is_reported(tmp_path):
    folder = copy_scenario("homocline", tmp_path / "s")
    text = (folder / "scenario.yaml").read_text(encoding="utf-8")
    (folder / "scenario.yaml").write_text(text.replace("elevation: 1000}", "elevation: 1100}"), encoding="utf-8")
    with pytest.raises(ConfigError, match="outside the block"):
        bake(folder, tmp_path / "out")


def test_invalid_yaml_is_reported(tmp_path):
    folder = copy_scenario("homocline", tmp_path / "s")
    text = (folder / "scenario.yaml").read_text(encoding="utf-8")
    (folder / "scenario.yaml").write_text(text.replace("resistance: 0.8", "resistance: 8"), encoding="utf-8")
    with pytest.raises(ConfigError, match="units/basement/resistance"):
        load_config(folder)
    with pytest.raises(ConfigError, match="no variant"):
        load_config(SCENARIOS / "homocline", variant="z")


def test_fault_outcrops_show_kinematic_indicators(faulted):
    """Since 1.3.0: fault outcrops carry a shear-sense indicator with the sense of the stated kinematics."""
    on_fault = [o for o in faulted.outcrops if any(p["kind"] == "fault_plane" for p in o["observation"]["planes"])]
    assert on_fault
    shown = [o["observation"]["kinematic"] for o in on_fault if "kinematic" in o["observation"]]
    assert shown, "at least one fault outcrop shows an indicator"
    for k in shown:
        assert k["sense"] == "reverse"
        assert k["indicator"] in {"steps", "riedel", "tension_gashes", "drag"}
    for o in on_fault:
        k = o["observation"].get("kinematic")
        if k:
            assert any(p["id"] == k["plane"] and p["kind"] == "fault_plane" for p in o["observation"]["planes"])
    assert all("kinematic" not in o["observation"] for o in faulted.outcrops if o not in on_fault)
