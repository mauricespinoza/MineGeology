"""Bake core: GemPy model -> lithology block, bedding field, true map and contact traces.

Then the exposure model decides where rock crops out, and the outcrop catalogue
records what each outcrop shows.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from scipy import ndimage

from . import outcrops as outcrop_rules
from .authoring import BakeContext
from .exposure import expose
from .photos import attach_photos
from .runner import ModelRunner
from .scenario_config import ConfigError, ScenarioConfig, load_config
from .scenario_format import encode_rle8, gzip_bytes, validate_scenario
from .terrain import procedural_terrain
from .traces import trace

FORMAT_VERSION = "1.2.0"
TERRAIN_SCALE_M = 0.1
PUBLIC_UNIT_FIELDS = (
    "key", "rock_class", "lithology", "colour", "texture", "resistance", "description", "fossils", "thin_section",
)


class BakeError(Exception):
    pass


@dataclass
class BakeResult:
    """The baked arrays, kept for the validation report and the exposure model."""

    folder: Path
    config: ScenarioConfig
    unit_names: list[str]  # GemPy element name per unit index
    elevation: np.ndarray  # (ny, nx) metres
    litho: np.ndarray  # (nz, ny, nx) unit index
    poles: dict[str, np.ndarray]  # series key -> (nz, ny, nx, 3) int8
    true_map: np.ndarray  # (ny, nx) unit index
    truth: dict[str, Any]
    cover: np.ndarray  # (ny, nx) cover class
    outcrop_labels: np.ndarray  # (ny, nx) outcrop number from 1, 0 where covered
    outcrops: list[dict[str, Any]]


def _load_model(folder: Path):
    path = folder / "model.py"
    if not path.exists():
        raise ConfigError(f"{path} is missing")
    digest = hashlib.sha1(str(path.resolve()).encode()).hexdigest()[:10]
    spec = importlib.util.spec_from_file_location(f"geomapper_scenario_{digest}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "build_model"):
        raise ConfigError(f"{path} must define build_model(ctx)")
    return module


def _check_names(cfg: ScenarioConfig, runner: ModelRunner) -> None:
    problems = []
    series = {g.name for g in runner.groups if not g.is_fault}
    faults = {g.name for g in runner.groups if g.is_fault}
    for what, in_model, in_yaml in (
        ("units", set(runner.elements), set(cfg["units"]) - {d["unit"] for d in cfg.get("dykes", [])}),
        ("series", series, set(cfg["series"])),
        ("faults", faults, set(cfg.get("faults", {}))),
    ):
        if in_model - in_yaml:
            problems.append(f"{what} in model.py but not in scenario.yaml: {', '.join(sorted(in_model - in_yaml))}")
        if in_yaml - in_model:
            problems.append(f"{what} in scenario.yaml but not in model.py: {', '.join(sorted(in_yaml - in_model))}")
    if problems:
        raise ConfigError("model.py and scenario.yaml disagree:\n  " + "\n  ".join(problems))


def _runs(values: np.ndarray) -> list[list[int]]:
    flat = values.ravel()
    starts = np.concatenate([[0], np.flatnonzero(np.diff(flat)) + 1])
    lengths = np.diff(np.concatenate([starts, [flat.size]]))
    return [[int(flat[s]), int(n)] for s, n in zip(starts, lengths)]


def _dump(doc: Any) -> bytes:
    return (json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def bake(
    scenario_dir: Path | str,
    out_dir: Path | str | None = None,
    variant: str | None = None,
    coarsen: int = 1,
    report: bool = False,
) -> BakeResult:
    """coarsen > 1 bakes a quick draft with cells that many times larger."""
    cfg = load_config(scenario_dir, variant)
    grid = cfg["grid"]
    d = float(grid["cell_size_m"]) * coarsen
    dz = float(grid.get("cell_height_m", grid["cell_size_m"])) * coarsen
    nx, ny, nz = (max(grid[k] // coarsen, 2) for k in ("nx", "ny", "nz"))
    z0 = float(grid["origin"]["elevation"])
    options = cfg.get("bake", {})
    refine = options.get("trace_refinement", 4)
    buffer = options.get("mask_buffer_cells", 0)

    ctx = BakeContext(extent=(0.0, nx * d, 0.0, ny * d, z0, z0 + nz * dz), params=cfg.params, seed=cfg.seed)
    module = _load_model(cfg.folder)
    runner = ModelRunner(module.build_model(ctx))
    _check_names(cfg, runner)

    # --- terrain -----------------------------------------------------------
    x = (np.arange(nx) + 0.5) * d
    y = (np.arange(ny) + 0.5) * d
    terrain_cfg = cfg.get("terrain", {})
    if "procedural" in terrain_cfg:
        resistance_of = np.array([cfg["units"][e]["resistance"] for e in runner.elements])
        sy0, sx0 = np.meshgrid(y, x, indexing="ij")

        def surface_resistance(elev: np.ndarray) -> np.ndarray:
            clipped = np.clip(elev, z0, z0 + nz * dz)
            points = np.column_stack([sx0.ravel(), sy0.ravel(), clipped.ravel()])
            return resistance_of[runner.evaluate(points).element].reshape(ny, nx)

        elevation = procedural_terrain(
            (ny, nx), d, terrain_cfg["procedural"], np.random.default_rng([cfg.seed, 1]), surface_resistance
        )
        # Generated relief is made to fit: valleys and peaks that leave the block are cut flat.
        elevation = np.clip(elevation, z0 + dz, z0 + (nz - 1) * dz)
    elif "file" in terrain_cfg:
        elevation = np.load(cfg.folder / terrain_cfg["file"]).astype(float)
    elif hasattr(module, "build_terrain"):
        elevation = np.asarray(module.build_terrain(*np.meshgrid(x, y), ctx), dtype=float)
    else:
        raise ConfigError(
            "no terrain: give terrain.procedural or terrain.file in scenario.yaml, or build_terrain(x, y, ctx) in model.py"
        )
    if elevation.shape != (ny, nx):
        raise ConfigError(f"terrain has shape {elevation.shape}, the grid needs {(ny, nx)} (rows are northings)")
    if elevation.min() < z0 or elevation.max() > z0 + nz * dz:
        raise ConfigError(
            f"terrain runs from {elevation.min():.1f} to {elevation.max():.1f} m, "
            f"outside the block ({z0:.1f} to {z0 + nz * dz:.1f} m)"
        )
    stored = np.rint((elevation - z0) / TERRAIN_SCALE_M)
    if stored.max() > 65535:
        raise ConfigError("relief is too large for the terrain encoding (6553 m above the block base)")
    elevation = z0 + stored * TERRAIN_SCALE_M  # the game sees these exact values

    # --- one GemPy evaluation: block, surface cells, refined surface -------
    zc = z0 + (np.arange(nz) + 0.5) * dz
    bz, by, bx = np.meshgrid(zc, y, x, indexing="ij")
    block_xyz = np.column_stack([bx.ravel(), by.ravel(), bz.ravel()])
    sy, sx = np.meshgrid(y, x, indexing="ij")
    surface_xyz = np.column_stack([sx.ravel(), sy.ravel(), elevation.ravel()])
    fx = (np.arange(nx * refine) + 0.5) * d / refine
    fy = (np.arange(ny * refine) + 0.5) * d / refine
    gy, gx = np.meshgrid(fy, fx, indexing="ij")
    fine_elev = ndimage.map_coordinates(elevation, [gy / d - 0.5, gx / d - 0.5], order=1, mode="nearest")
    fine_xyz = np.column_stack([gx.ravel(), gy.ravel(), fine_elev.ravel()])
    n_block, n_surface = len(block_xyz), len(surface_xyz)
    ev = runner.evaluate(np.vstack([block_xyz, surface_xyz, fine_xyz]))

    # --- units and series --------------------------------------------------
    unit_names = sorted(cfg["units"], key=lambda name: cfg["units"][name]["key"])
    unit_keys = [cfg["units"][name]["key"] for name in unit_names]
    to_unit = np.array([unit_names.index(e) for e in runner.elements])
    unit = to_unit[ev.element]
    group_of_element = np.array([runner.element_group[e] for e in runner.elements])
    group = group_of_element[ev.element]
    unit_group = {name: runner.element_group.get(name, -1) for name in unit_names}  # -1: dyke rock

    fault_groups = [i for i, g in enumerate(runner.groups) if g.is_fault]
    fault_side = np.zeros((len(fault_groups), len(unit)), dtype=bool)
    fault_active = np.zeros((len(fault_groups), len(unit)), dtype=bool)
    for k, i in enumerate(fault_groups):
        fault_side[k] = ev.scalar[i] > ev.threshold[i][0]
        fault_active[k] = np.isin(group, runner.groups[i].offsets)

    litho = unit[:n_block].reshape(nz, ny, nx).astype(np.uint8)
    true_map = unit[n_block : n_block + n_surface].reshape(ny, nx).astype(np.uint8)

    # --- bedding field -----------------------------------------------------
    block_group = group[:n_block].reshape(nz, ny, nx)
    masked = np.zeros((nz, ny, nx), dtype=bool)
    if buffer > 0:
        domain = block_group.copy()
        for k in range(len(fault_groups)):
            bit = (fault_side[k, :n_block] & fault_active[k, :n_block]).reshape(nz, ny, nx)
            domain = domain * 2 + bit
        for axis in range(3):
            lo = [slice(None)] * 3
            hi = [slice(None)] * 3
            lo[axis], hi[axis] = slice(0, -1), slice(1, None)
            differs = domain[tuple(lo)] != domain[tuple(hi)]
            masked[tuple(lo)] |= differs
            masked[tuple(hi)] |= differs
        if buffer > 1:
            masked = ndimage.binary_dilation(masked, iterations=buffer - 1)

    bedded = sorted(
        (
            (cfg["series"][g.name]["key"], i, g.name)
            for i, g in enumerate(runner.groups)
            if not g.is_fault and not cfg["series"][g.name].get("intrusive")
        )
    )
    poles: dict[str, np.ndarray] = {}
    for key, i, _ in bedded:
        gradient = ev.gradient[i][:n_block]
        norm = np.linalg.norm(gradient, axis=1, keepdims=True)
        pole = np.rint(127.0 * gradient / np.where(norm > 0, norm, 1.0)).astype(np.int8).reshape(nz, ny, nx, 3)
        pole[(block_group != i) | masked | (norm.reshape(nz, ny, nx) == 0)] = 0
        poles[key] = pole

    # --- contact and fault traces -----------------------------------------
    fine = slice(n_block + n_surface, None)
    shape = (ny * refine, nx * refine)
    lines = trace(
        unit[fine].reshape(shape),
        fault_side[:, fine].reshape(-1, *shape),
        fault_active[:, fine].reshape(-1, *shape),
        min_length=float(refine),
    )
    origin = grid["origin"]

    def younger_group(a: str, b: str) -> int:
        return min(unit_group[a], unit_group[b])  # GemPy lists groups youngest first

    def contact_kind(a: str, b: str) -> str:
        if unit_group[a] == unit_group[b]:
            return "depositional"
        younger = runner.groups[younger_group(a, b)].name  # the younger series made the contact
        return "intrusive" if cfg["series"][younger].get("intrusive") else "unconformity"

    features = []
    for label, pts in lines:
        coords = np.round(pts * (d / refine) + [origin["easting"], origin["northing"]], 1).tolist()
        if label[0] == "fault":
            name = runner.groups[fault_groups[label[1]]].name
            props = {"type": "fault", "kinematics": cfg["faults"][name]["kinematics"]}
        else:
            kind = contact_kind(unit_names[label[1]], unit_names[label[2]])
            props = {"type": kind, "units": sorted([unit_keys[label[1]], unit_keys[label[2]]])}
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {"id": f"c{len(features) + 1:02d}", **props},
            }
        )

    # --- dykes, exposure and outcrops ---------------------------------------
    surface = slice(n_block, n_block + n_surface)
    dykes = [outcrop_rules.build_dyke(spec, elevation, d) for spec in cfg.get("dykes", [])]
    dyke_cells = np.any([k.cells for k in dykes], axis=0) if dykes else None
    resistance = np.array([cfg["units"][name]["resistance"] for name in unit_names])[true_map]
    exposure = expose(elevation, d, resistance, np.random.default_rng([cfg.seed, 2]), cfg.get("exposure"), dyke_cells)
    bedded_groups = {i: key for key, i, _ in bedded}
    outcrops, key_outcrops = outcrop_rules.catalogue(
        labels=exposure.labels,
        elevation=elevation,
        cell=d,
        origin=origin,
        unit=true_map,
        unit_names=unit_names,
        units_cfg=cfg["units"],
        unit_group=unit_group,
        bedded_groups=set(bedded_groups),
        gradient=[g[surface].reshape(ny, nx, 3) for g in ev.gradient],
        faults=[
            {
                "group": i,
                "kinematics": cfg["faults"][runner.groups[i].name]["kinematics"],
                "side": fault_side[k, surface].reshape(ny, nx),
                "active": fault_active[k, surface].reshape(ny, nx),
            }
            for k, i in enumerate(fault_groups)
        ],
        dykes=dykes,
        contact_kind=contact_kind,
        younger_group=younger_group,
        rng=np.random.default_rng([cfg.seed, 3]),
        language=cfg.get("language", "es"),
    )

    # --- documents ---------------------------------------------------------
    truth_units = []
    for name in unit_names:
        u = cfg["units"][name]
        entry = {"key": u["key"], "name": u["name"], "age": u["age"]}
        if unit_group[name] in bedded_groups:
            entry["series"] = bedded_groups[unit_group[name]]
        if "lab_age" in u:
            entry["lab_age"] = u["lab_age"]
        truth_units.append(entry)

    column = []
    for i in sorted(bedded_groups, reverse=True):  # oldest series first
        members = [e for e in runner.elements if runner.element_group[e] == i]
        for j, name in enumerate(reversed(members)):  # oldest unit first
            row = {"unit": cfg["units"][name]["key"]}
            if "thickness_m" in cfg["units"][name]:
                row["thickness_m"] = cfg["units"][name]["thickness_m"]
            row["base_contact"] = "depositional" if j else ("unconformity" if column else "not_exposed")
            column.append(row)

    events = []
    for n, e in enumerate(cfg["events"], start=1):
        event = {"id": f"e{n:02d}", **{k: v for k, v in e.items() if k != "units"}}
        if "units" in e:
            event["units"] = [cfg["units"][name]["key"] for name in e["units"]]
        events.append(event)

    truth = {
        "units": truth_units,
        "column": column,
        "events": events,
        "map": {"encoding": "rle", "runs": _runs(true_map)},
        "contacts": {"type": "FeatureCollection", "features": features},
        "fold_axes": [],
        "lumpable": [[cfg["units"][name]["key"] for name in g] for g in cfg.get("lumpable", [])],
        "key_outcrops": key_outcrops,
    }
    if dykes:
        truth["dykes"] = [
            {
                "id": f"d{n:02d}",
                "unit": cfg["units"][k.unit]["key"],
                "strike": k.strike,
                "dip": k.dip,
                "thickness_m": k.thickness_m,
                "trace": {
                    "type": "LineString",
                    "coordinates": np.round(k.trace + [origin["easting"], origin["northing"]], 1).tolist(),
                },
            }
            for n, k in enumerate(dykes, start=1)
            if len(k.trace) >= 2
        ]
    out = Path(out_dir) if out_dir else Path("build") / f"{cfg['id']}-{cfg.variant}{'-x%d' % coarsen if coarsen > 1 else ''}"
    out.mkdir(parents=True, exist_ok=True)
    assets, photos = attach_photos(cfg.folder, cfg["units"], out)
    units_doc = {
        "units": [
            {**{k: cfg["units"][n][k] for k in PUBLIC_UNIT_FIELDS if k in cfg["units"][n]}, **({"photos": photos[cfg["units"][n]["key"]]} if cfg["units"][n]["key"] in photos else {})}
            for n in unit_names
        ]
    }

    # --- files -------------------------------------------------------------
    orient = b"".join(poles[key].tobytes() for key, _, _ in bedded)
    payloads = {
        "terrain": ("terrain.bin", "u16le+gzip", "public", gzip_bytes(stored.astype("<u2").tobytes())),
        "cover": ("cover.bin", "u8+gzip", "public", gzip_bytes(exposure.cover.tobytes())),
        "outcrops": ("outcrops.json", "json", "public", _dump({"outcrops": outcrops})),
        "units": ("units.json", "json", "public", _dump(units_doc)),
        "litho": ("litho.bin", "rle8+gzip", "reveal", encode_rle8(litho.tobytes())),
        "orient": ("orient.bin", "i8x3+gzip", "reveal", gzip_bytes(orient)),
        "truth": ("truth.json", "json", "truth", _dump(truth)),
    }
    files = {}
    for role, (path, encoding, visibility, data) in payloads.items():
        (out / path).write_bytes(data)
        files[role] = {
            "path": path,
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "encoding": encoding,
            "visibility": visibility,
        }
    manifest = {
        "format_version": FORMAT_VERSION,
        "scenario_id": cfg["id"],
        "variant": cfg.variant,
        "title": cfg["title"],
        "level": cfg["level"],
        "language": cfg.get("language", "es"),
        "seed": cfg.seed,
        "grid": {"nx": nx, "ny": ny, "nz": nz, "cell_size_m": {"x": d, "y": d, "z": dz}, "origin": origin},
        "terrain": {"scale_m": TERRAIN_SCALE_M, "offset_m": z0},
        "series": [{"key": key, "kind": cfg["series"][name]["kind"]} for key, _, name in bedded],
        "rules": cfg.rules,
        "exposure_fraction": round(exposure.fraction, 4),
        **({"assets": assets} if assets else {}),
        "files": files,
    }
    (out / "manifest.json").write_bytes(
        (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    )

    check = validate_scenario(out)
    if not check.ok:
        raise BakeError("the bake wrote an invalid scenario:\n  " + "\n  ".join(check.errors))
    result = BakeResult(
        folder=out,
        config=cfg,
        unit_names=unit_names,
        elevation=elevation,
        litho=litho,
        poles=poles,
        true_map=true_map,
        truth=truth,
        cover=exposure.cover,
        outcrop_labels=exposure.labels,
        outcrops=outcrops,
    )
    if report:
        from .report import write_report

        write_report(result)
    return result
