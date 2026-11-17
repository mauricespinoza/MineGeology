"""Outcrop catalogue and rule-based minor structures (dykes, striae)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
from scipy import ndimage

from .authoring import pole_from_strike_dip, strike_dip_from_pole
from .traces import simplify

# Observation texts shown to the student, by interface language.
TEXTS = {
    "es": {
        "contact_feature": "Contacto expuesto entre dos tipos de roca",
        "fault_feature": "Zona de falla expuesta",
        "dyke_feature": "Dique de {lithology} de unos {thickness:g} m de espesor que corta la roca de caja",
        "evidence": {
            "depositional": ["Contacto neto y paralelo a la estratificación", "Sin superficie de erosión ni discordancia angular"],
            "unconformity": [
                "Superficie de erosión irregular",
                "Discordancia angular entre las capas de ambos lados",
                "Clastos de la unidad inferior en la base de la superior",
            ],
            "intrusive": [
                "Margen de enfriamiento de grano fino",
                "Roca de caja endurecida y decolorada junto al contacto",
                "El contacto corta la estratificación",
            ],
            "fault": ["Plano pulido con estrías", "Brecha y salbanda de falla", "Escalones sobre el plano de falla"],
        },
    }
}


@dataclass
class Dyke:
    unit: str  # element name in scenario.yaml
    strike: float
    dip: float
    thickness_m: float
    trace: np.ndarray  # (n, 2) model x, y
    cells: np.ndarray  # (ny, nx) bool


def _terrain_at(elevation: np.ndarray, cell: float, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    return ndimage.map_coordinates(elevation, [y / cell - 0.5, x / cell - 0.5], order=1, mode="nearest")


def build_dyke(spec: dict[str, Any], elevation: np.ndarray, cell: float) -> Dyke:
    """Intersect a planar dyke with the terrain. spec: unit, through [x, y, z], strike, dip, thickness_m, length_m."""
    ny, nx = elevation.shape
    x0, y0, z0 = (float(v) for v in spec["through"])
    strike, dip = math.radians(spec["strike"]), math.radians(spec["dip"])
    along = (math.sin(strike), math.cos(strike))
    down_dip = (math.sin(strike + math.pi / 2), math.cos(strike + math.pi / 2))
    t = np.arange(-spec["length_m"] / 2, spec["length_m"] / 2 + cell / 4, cell / 2)
    x, y = x0 + t * along[0], y0 + t * along[1]
    run = 1.0 / math.tan(dip) if spec["dip"] < 89.999 else 0.0
    for _ in range(12):  # the trace shifts down dip where the ground is lower
        shift = (z0 - _terrain_at(elevation, cell, x, y)) * run
        x, y = x0 + t * along[0] + shift * down_dip[0], y0 + t * along[1] + shift * down_dip[1]
    inside = (x >= 0) & (x < nx * cell) & (y >= 0) & (y < ny * cell)
    x, y = x[inside], y[inside]
    cells = np.zeros((ny, nx), dtype=bool)
    cells[(y / cell).astype(int), (x / cell).astype(int)] = True
    trace = simplify(np.column_stack([x, y]), tolerance=1.0) if len(x) > 1 else np.empty((0, 2))
    return Dyke(spec["unit"], float(spec["strike"]), float(spec["dip"]), float(spec["thickness_m"]), trace, cells)


def _plane(pid: int, kind: str, pole: np.ndarray) -> dict[str, Any]:
    strike, dip, overturned = strike_dip_from_pole(pole)
    plane: dict[str, Any] = {"id": f"p{pid}", "kind": kind, "strike": round(strike, 1) % 360.0, "dip": round(dip, 1)}
    if overturned:
        plane["overturned"] = True
    return plane


def striae(strike: float, dip: float, kinematics: str) -> dict[str, Any]:
    """Slip line on a fault plane, from its stated kinematics."""
    if kinematics in ("dextral", "sinistral"):
        return {"kind": "striae", "trend": round(strike, 1) % 360.0, "plunge": 0.0}
    if kinematics == "oblique":  # rake of 45 degrees
        pole = pole_from_strike_dip(strike, dip)
        s = np.array([math.sin(math.radians(strike)), math.cos(math.radians(strike)), 0.0])
        d = np.cross(pole, s)
        line = s + (d if d[2] < 0 else -d)
        line /= np.linalg.norm(line)
        return {
            "kind": "striae",
            "trend": round(math.degrees(math.atan2(line[0], line[1])) % 360.0, 1) % 360.0,
            "plunge": round(math.degrees(math.asin(-line[2])), 1),
        }
    return {"kind": "striae", "trend": round(strike + 90.0, 1) % 360.0, "plunge": round(dip, 1)}


def catalogue(
    *,
    labels: np.ndarray,
    elevation: np.ndarray,
    cell: float,
    origin: dict[str, float],
    unit: np.ndarray,  # (ny, nx) unit index at the surface
    unit_names: list[str],
    units_cfg: dict[str, dict[str, Any]],
    unit_group: dict[str, int],
    bedded_groups: set[int],
    gradient: list[np.ndarray],  # per group: (ny, nx, 3) at the surface
    faults: list[dict[str, Any]],  # group, kinematics, side (ny, nx), active (ny, nx)
    dykes: list[Dyke],
    contact_kind: Callable[[str, str], str],
    younger_group: Callable[[str, str], int],
    rng: np.random.Generator,
    language: str = "es",
) -> tuple[list[dict[str, Any]], list[str]]:
    """Returns the outcrops and the ids of the key ones (those that show a contact, fault or dyke)."""
    text = TEXTS.get(language, TEXTS["es"])
    outcrops, key_ids = [], []
    for n, window in enumerate(ndimage.find_objects(labels), start=1):
        iy, ix = np.nonzero(labels[window] == n)
        iy, ix = iy + window[0].start, ix + window[1].start
        oid = f"o{n:03d}"

        present, counts = np.unique(unit[iy, ix], return_counts=True)
        ranked = present[np.argsort(-counts, kind="stable")]
        main = unit_names[ranked[0]]
        cfg = units_cfg[main]
        of_main = unit[iy, ix] == ranked[0]
        centre = np.argmin((iy - iy[of_main].mean()) ** 2 + (ix - ix[of_main].mean()) ** 2 + 1e6 * ~of_main)
        cy, cx = int(iy[centre]), int(ix[centre])

        resistance = cfg["resistance"]
        roll = rng.random()
        quality = "good" if roll < 0.15 + 0.5 * resistance else ("poor" if roll > 0.95 - 0.3 * (1 - resistance) else "fair")
        features = list(cfg.get("features", []))
        if features:
            picks = rng.permutation(len(features))[: 1 if quality == "poor" else 2]
            features = [features[i] for i in sorted(picks)]

        planes: list[dict[str, Any]] = []
        group = unit_group[main]
        if group in bedded_groups:
            planes.append(_plane(1, "bedding", gradient[group][cy, cx]))
        obs: dict[str, Any] = {"quality": quality, "unit": cfg["key"], "features": features, "planes": planes}

        indicators = cfg.get("way_up", [])
        show = {"good": 0.8, "fair": 0.5, "poor": 0.15}[quality]
        draw = rng.random()
        pick = int(rng.integers(len(indicators))) if indicators else 0
        if indicators and planes and draw < show:
            obs["way_up"] = {
                "indicator": indicators[pick],
                "younging": "overturned" if planes[0].get("overturned") else "upright",
            }

        contact = None
        fault = next((f for f in faults if f["active"][iy, ix].all() and np.ptp(f["side"][iy, ix].astype(int))), None)
        if fault is not None:
            plane = _plane(len(planes) + 1, "fault_plane", gradient[fault["group"]][cy, cx])
            plane["lineation"] = striae(plane["strike"], plane["dip"], fault["kinematics"])
            planes.append(plane)
            other = unit_names[ranked[1]] if len(ranked) > 1 else main
            contact = {"type": "fault", "units": [cfg["key"], units_cfg[other]["key"]], "evidence": text["evidence"]["fault"][:2], "plane": plane["id"]}
            features.append(text["fault_feature"])
        elif len(ranked) > 1:
            other = unit_names[ranked[1]]
            kind = contact_kind(main, other)
            contact = {"type": kind, "units": [cfg["key"], units_cfg[other]["key"]], "evidence": text["evidence"][kind][:2]}
            pole = None
            if kind == "depositional" and planes:
                pole = gradient[group][cy, cx]
            elif kind == "unconformity" and younger_group(main, other) in bedded_groups:
                pole = gradient[younger_group(main, other)][cy, cx]
            if pole is not None:
                planes.append(_plane(len(planes) + 1, "contact", pole))
                contact["plane"] = planes[-1]["id"]
            features.append(text["contact_feature"])

        for dyke in dykes:
            if not dyke.cells[iy, ix].any():
                continue
            rock = units_cfg[dyke.unit]
            planes.append(_plane(len(planes) + 1, "dyke", pole_from_strike_dip(dyke.strike, dyke.dip)))
            features.append(text["dyke_feature"].format(lithology=rock["lithology"], thickness=dyke.thickness_m))
            if contact is None:
                contact = {
                    "type": "intrusive",
                    "units": [cfg["key"], rock["key"]],
                    "evidence": text["evidence"]["intrusive"],
                    "plane": planes[-1]["id"],
                }

        if contact is not None:
            obs["contact"] = contact
            key_ids.append(oid)
        obs["features"] = features
        obs["sampleable"] = quality != "poor"

        outcrops.append(
            {
                "id": oid,
                "position": {
                    "easting": origin["easting"] + (cx + 0.5) * cell,
                    "northing": origin["northing"] + (cy + 0.5) * cell,
                    "elevation": round(float(elevation[cy, cx]), 1),
                },
                "cells": [[int(a), int(b)] for a, b in sorted(zip(ix.tolist(), iy.tolist()), key=lambda c: (c[1], c[0]))],
                "observation": obs,
            }
        )
    return outcrops, key_ids
