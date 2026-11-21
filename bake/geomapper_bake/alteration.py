"""Hydrothermal alteration that overprints the lithology (format 1.6.0).

Alteration does not replace a unit, as a contact aureole does: an altered andesite is still an andesite,
and the student maps both its rock and what has happened to it. So the bake keeps the alteration in a
layer of its own. Each zone of `alteration.zones` in scenario.yaml is a union of regions, and each region
is a set of conditions on distances to units and faults, on elevation and on the host rock. Zones are
listed by priority: a point takes the first zone whose region holds it. That is enough for the shells of
a porphyry system (a potassic core, a phyllic shell, an advanced argillic cap, a propylitic halo), for
alteration channelled along a fault, and for strata-bound bodies confined to permeable beds near a feeder.

Distances are measured in 3D on the lithology block (cell centres), so they are good to about one cell,
as for aureoles. Zone limits can be made to wander with smooth noise, so that they are not perfect
offsets of the intrusion.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import ndimage

from .authoring import pole_from_strike_dip
from .outcrops import _plane

INTENSITY = ("weak", "moderate", "strong")


@dataclass
class Alteration:
    zone_names: list[str]  # scenario.yaml names, in the order of the keys (the order of the files)
    value: np.ndarray  # per evaluated point: 0 unaltered, k = zone_names[k - 1]
    score: np.ndarray  # per point, 0 to 1: how far inside its zone (drives intensity)


def _distance_from(inside: np.ndarray, d: float, dz: float) -> np.ndarray:
    """Distance in metres of every block cell from the cells marked inside (0 there)."""
    if not inside.any():
        return np.full(inside.shape, np.inf)
    return ndimage.distance_transform_edt(~inside, sampling=(dz, d, d))


def _boundary(side: np.ndarray) -> np.ndarray:
    """Cells on either side of a change in a boolean block: the trace of a fault surface."""
    edge = np.zeros(side.shape, dtype=bool)
    for axis in range(3):
        lo = [slice(None)] * 3
        hi = [slice(None)] * 3
        lo[axis], hi[axis] = slice(0, -1), slice(1, None)
        differs = side[tuple(lo)] != side[tuple(hi)]
        edge[tuple(lo)] |= differs
        edge[tuple(hi)] |= differs
    return edge


def _noise(points: np.ndarray, scale: float, rng: np.random.Generator, waves: int = 6) -> np.ndarray:
    """Smooth noise of about unit amplitude: a sum of plane waves in random directions."""
    out = np.zeros(len(points))
    for _ in range(waves):
        direction = rng.normal(size=3)
        direction[2] *= 0.5  # zones wander more across than up and down
        direction /= np.linalg.norm(direction)
        k = 2 * math.pi / (scale * rng.uniform(0.7, 1.4))
        out += np.cos(points @ (direction * k) + rng.uniform(0, 2 * math.pi))
    return out * math.sqrt(2.0 / waves)


def evaluate(
    cfg,
    unit_names: list[str],
    unit_block: np.ndarray,  # (nz, ny, nx) unit index
    fault_sides: dict[str, np.ndarray],  # fault name -> (nz, ny, nx) bool side of the fault
    points: np.ndarray,  # (n, 3) model x, y, elevation
    point_unit: np.ndarray,  # (n,) unit index at each point
    z0: float,
    d: float,
    dz: float,
) -> Alteration | None:
    spec = cfg.get("alteration")
    if not spec:
        return None
    zones = spec["zones"]
    order = sorted(zones, key=lambda n: zones[n]["key"])
    noise_m = float(spec.get("noise_m", 0.0))
    scale = float(spec.get("noise_scale_m", 400.0))

    names = set()
    for z in zones.values():
        for region in z["where"]:
            names |= set(region.get("within_m", {})) | set(region.get("beyond_m", {}))
    coords = [points[:, 2] / dz - z0 / dz - 0.5, points[:, 1] / d - 0.5, points[:, 0] / d - 0.5]
    distance: dict[str, np.ndarray] = {}
    for name in sorted(names):
        if name in fault_sides:
            field = _distance_from(_boundary(fault_sides[name]), d, dz)
            # The trace cells straddle the surface, half a cell from it on each side.
            field = np.maximum(field - 0.5 * min(d, dz), 0.0)
        else:
            field = _distance_from(unit_block == unit_names.index(name), d, dz)
        finite = np.where(np.isfinite(field), field, 1e9)
        at = ndimage.map_coordinates(finite, coords, order=1, mode="nearest")
        if name not in fault_sides:
            at = np.where(point_unit == unit_names.index(name), 0.0, at)
        distance[name] = at

    n = len(points)
    value = np.zeros(n, dtype=np.uint8)
    score = np.zeros(n)
    taken = np.zeros(n, dtype=bool)
    for zone_name in zones:  # by priority, as listed
        z = zones[zone_name]
        wobble = noise_m * _noise(points, scale, np.random.default_rng([cfg.seed, 6, order.index(zone_name)])) if noise_m else 0.0
        hosts = z.get("hosts")
        in_zone = np.zeros(n, dtype=bool)
        depth = np.zeros(n)
        for region in z["where"]:
            ok = np.ones(n, dtype=bool)
            inner = np.ones(n)
            for name, limit in region.get("within_m", {}).items():
                dist = distance[name] + wobble
                ok &= dist <= limit
                inner = np.minimum(inner, np.clip((limit - dist) / max(limit, 1.0), 0.0, 1.0))
            for name, limit in region.get("beyond_m", {}).items():
                ok &= distance[name] + wobble >= limit
            if "above_m" in region:
                ok &= points[:, 2] + wobble >= region["above_m"]
            if "below_m" in region:
                ok &= points[:, 2] + wobble <= region["below_m"]
            for allowed in (region.get("hosts"), hosts):
                if allowed:
                    ok &= np.isin(point_unit, [unit_names.index(h) for h in allowed])
            depth = np.where(ok & (inner > depth), inner, depth)
            in_zone |= ok
        new = in_zone & ~taken
        value[new] = order.index(zone_name) + 1
        score[new] = depth[new]
        taken |= in_zone
    return Alteration(zone_names=order, value=value, score=score)


def intensity(score: float) -> str:
    return INTENSITY[2] if score >= 0.45 else INTENSITY[1] if score >= 0.15 else INTENSITY[0]


def annotate(
    outcrops: list[dict[str, Any]],
    cfg,
    alteration: Alteration,
    value_map: np.ndarray,  # (ny, nx)
    score_map: np.ndarray,  # (ny, nx)
    rng: np.random.Generator,
) -> None:
    """Adds to each altered outcrop its zone and intensity, one of the zone's features and, often, a vein to measure.

    Runs on a random stream of its own, so the rest of the outcrops are drawn as they were without alteration.
    """
    zones = cfg["alteration"]["zones"]
    for o in outcrops:
        ix, iy = np.array(o["cells"]).T
        values = value_map[iy, ix]
        found, counts = np.unique(values, return_counts=True)
        top = int(found[np.argmax(counts)])
        draw_feature, draw_vein, pick = rng.random(), rng.random(), int(rng.integers(1 << 30))
        scatter = rng.normal(size=3)
        if top == 0:
            continue
        name = alteration.zone_names[top - 1]
        z = zones[name]
        obs = o["observation"]
        level = intensity(float(score_map[iy, ix][values == top].mean()))
        obs["alteration"] = {"key": z["key"], "intensity": level}
        if obs["quality"] == "poor":
            continue
        features = z.get("features", [])
        if features and draw_feature < {"weak": 0.4, "moderate": 0.7, "strong": 0.9}[level]:
            obs["features"].append(features[pick % len(features)])
        veins = z.get("veins")
        if veins and draw_vein < veins.get("chance", 0.6) * (1.0 if level != "weak" else 0.5):
            spread = veins.get("spread_deg", 10.0)
            strike = (veins["strike"] + spread * scatter[0]) % 360.0
            dip = float(np.clip(veins["dip"] + 0.5 * spread * scatter[1], 1.0, 90.0))
            plane = _plane(len(obs["planes"]) + 1, "vein", pole_from_strike_dip(strike, dip))
            obs["planes"].append(plane)


def documents(cfg, alteration: Alteration, value_map: np.ndarray, runs) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """The public zone descriptions for units.json and the answer key for truth.json."""
    zones = cfg["alteration"]["zones"]
    public, keyed = [], []
    for name in alteration.zone_names:
        z = zones[name]
        public.append({k: z[k] for k in ("key", "colour", "minerals", "description", "features", "thin_section") if k in z})
        entry = {"key": z["key"], "name": z["name"], "type": z["type"]}
        if "assay" in z:
            entry["assay"] = z["assay"]
        keyed.append(entry)
    truth = {"zones": keyed, "map": {"encoding": "rle", "runs": runs(value_map)}}
    if "background_assay" in cfg["alteration"]:
        truth["background_assay"] = cfg["alteration"]["background_assay"]
    return public, truth
