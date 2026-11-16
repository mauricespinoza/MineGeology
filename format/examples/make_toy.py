"""Build the toy scenario in format/examples/toy.

A 16 x 16 x 8 grid of 10 m cells holding a planar homocline that strikes
north and dips 30 degrees east: three units, a small stream valley, three
outcrops. Standard library only, and deliberately independent of
geomapper_bake so that it checks the format readers rather than mirroring them.

Usage: python format/examples/make_toy.py [output_folder]
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

NX, NY, NZ = 16, 16, 8
CELL = 10.0
ORIGIN = {"easting": 352000.0, "northing": 5921000.0, "elevation": 1000.0}
TERRAIN_SCALE, TERRAIN_OFFSET = 0.1, 1000.0

STRIKE, DIP = 0.0, 30.0  # right-hand rule: dips toward 090
# Upward pole to bedding (east, north, up); it points toward younger beds.
POLE = (math.sin(math.radians(DIP)), 0.0, math.cos(math.radians(DIP)))
# Unit boundaries in stratigraphic height (metres along the pole).
TOPS = [55.0, 90.0]

BARE_ROCK, SOIL, ALLUVIUM, SCREE, VEGETATION = range(5)


def elevation(ix: int, iy: int) -> float:
    valley = 12.0 * math.exp(-(((iy - 7.5) / 3.0) ** 2))
    return round(1030.0 + 1.5 * ix - valley, 1)


def unit_at(x: float, z: float) -> int:
    """Unit index at x metres east of the origin and z metres above it."""
    height = x * POLE[0] + z * POLE[2]
    return sum(height >= top for top in TOPS)


def surface_unit(ix: int, iy: int) -> int:
    return unit_at((ix + 0.5) * CELL, elevation(ix, iy) - ORIGIN["elevation"])


def gz(data: bytes) -> bytes:
    return gzip.compress(data, compresslevel=9, mtime=0)


def rle8(values: list[int]) -> bytes:
    out = bytearray()
    i = 0
    while i < len(values):
        run = 1
        while i + run < len(values) and values[i + run] == values[i] and run < 65535:
            run += 1
        out += struct.pack("<BH", values[i], run)
        i += run
    return bytes(out)


def runs(values: list[int]) -> list[list[int]]:
    out: list[list[int]] = []
    for v in values:
        if out and out[-1][0] == v:
            out[-1][1] += 1
        else:
            out.append([v, 1])
    return out


def contact_trace(top: float) -> list[list[float]]:
    """Where the boundary at stratigraphic height `top` meets the terrain, row by row."""
    line = []
    for iy in range(NY):
        heights = [
            (ix + 0.5) * CELL * POLE[0] + (elevation(ix, iy) - ORIGIN["elevation"]) * POLE[2]
            for ix in range(NX)
        ]
        for ix in range(NX - 1):
            a, b = heights[ix], heights[ix + 1]
            if a < top <= b:
                x = (ix + 0.5 + (top - a) / (b - a)) * CELL
                line.append([round(ORIGIN["easting"] + x, 1), round(ORIGIN["northing"] + (iy + 0.5) * CELL, 1)])
                break
    return line


def position(cells: list[list[int]]) -> dict[str, float]:
    ix = sum(c[0] for c in cells) / len(cells)
    iy = sum(c[1] for c in cells) / len(cells)
    return {
        "easting": ORIGIN["easting"] + (ix + 0.5) * CELL,
        "northing": ORIGIN["northing"] + (iy + 0.5) * CELL,
        "elevation": max(elevation(*c) for c in cells),
    }


def build(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)

    terrain = [elevation(ix, iy) for iy in range(NY) for ix in range(NX)]
    true_map = [surface_unit(ix, iy) for iy in range(NY) for ix in range(NX)]

    # One outcrop per unit; the third straddles the contact between units 1 and 2.
    row = 12
    edge = next(ix for ix in range(NX - 1) if surface_unit(ix, row) == 1 and surface_unit(ix + 1, row) == 2)
    footprints = [[[1, 3], [2, 3]], [[8, 13]], [[edge, row], [edge + 1, row]]]
    assert [surface_unit(*f[0]) for f in footprints] == [0, 1, 1]
    exposed = {tuple(c) for f in footprints for c in f}

    cover = []
    for iy in range(NY):
        for ix in range(NX):
            if (ix, iy) in exposed:
                cover.append(BARE_ROCK)
            elif abs(iy - 7.5) < 1.0:
                cover.append(ALLUVIUM)
            elif (ix + 2 * iy) % 5 == 0:
                cover.append(VEGETATION)
            else:
                cover.append(SOIL)

    litho = [
        unit_at((ix + 0.5) * CELL, (iz + 0.5) * CELL)
        for iz in range(NZ)
        for iy in range(NY)
        for ix in range(NX)
    ]
    pole_bytes = struct.pack("<3b", *(round(c * 127) for c in POLE))

    keys = ["u07", "u02", "u11"]  # opaque on purpose: order says nothing about age
    bedding = {"id": "p1", "kind": "bedding", "strike": STRIKE, "dip": DIP}
    units = {
        "units": [
            {
                "key": keys[0],
                "rock_class": "volcanic",
                "lithology": "andesita porfídica",
                "colour": "#6b5b6e",
                "texture": "lava_porphyritic",
                "resistance": 0.8,
                "description": {
                    "field": "Lava gris violácea, maciza, en bancos de 2 a 5 m con techos vesiculares.",
                    "hand_lens": "Fenocristales de plagioclasa de 2 a 4 mm en masa fundamental afanítica; amígdalas de calcita y clorita.",
                },
                "thin_section": "Textura porfídica con plagioclasa zonada y clinopiroxeno en masa fundamental pilotaxítica.",
            },
            {
                "key": keys[1],
                "rock_class": "volcaniclastic",
                "lithology": "brecha volcánica",
                "colour": "#8a6f4d",
                "texture": "breccia_coarse",
                "resistance": 0.6,
                "description": {
                    "field": "Brecha pardo rojiza, mal seleccionada, en bancos gruesos con gradación normal.",
                    "hand_lens": "Clastos angulosos de andesita de 1 a 15 cm en matriz de ceniza y cristales rotos.",
                },
                "thin_section": "Fragmentos líticos andesíticos y cristales de plagioclasa en matriz vítrea alterada a arcillas.",
            },
            {
                "key": keys[2],
                "rock_class": "sedimentary",
                "lithology": "arenisca calcárea",
                "colour": "#c9b37e",
                "texture": "sandstone_bedded",
                "resistance": 0.4,
                "description": {
                    "field": "Arenisca amarillenta en capas de 10 a 40 cm con estratificación cruzada.",
                    "hand_lens": "Grano medio, bien seleccionada, cemento calcáreo; reacciona con ácido.",
                },
                "fossils": ["bivalvos trigónidos", "fragmentos de amonites"],
                "thin_section": "Litarenita con cemento esparítico y bioclastos de bivalvos.",
            },
        ]
    }

    outcrops = {
        "outcrops": [
            {
                "id": "o001",
                "position": position(footprints[0]),
                "cells": footprints[0],
                "observation": {
                    "quality": "good",
                    "unit": keys[0],
                    "features": ["techo de colada vesicular", "amígdalas concentradas hacia el techo"],
                    "planes": [bedding],
                    "way_up": {"indicator": "vesicle_zoning", "younging": "upright"},
                    "sampleable": True,
                },
            },
            {
                "id": "o002",
                "position": position(footprints[1]),
                "cells": footprints[1],
                "observation": {
                    "quality": "poor",
                    "unit": keys[1],
                    "features": ["roca meteorizada", "gradación normal en un banco"],
                    "planes": [bedding],
                    "way_up": {"indicator": "graded_bedding", "younging": "upright"},
                    "sampleable": False,
                },
            },
            {
                "id": "o003",
                "position": position(footprints[2]),
                "cells": footprints[2],
                "observation": {
                    "quality": "fair",
                    "unit": keys[1],
                    "features": ["contacto expuesto", "arenisca con estratificación cruzada sobre brecha"],
                    "planes": [bedding, {"id": "p2", "kind": "contact", "strike": STRIKE, "dip": DIP}],
                    "way_up": {"indicator": "cross_bedding", "younging": "upright"},
                    "contact": {
                        "type": "depositional",
                        "units": [keys[1], keys[2]],
                        "evidence": ["contacto concordante y neto", "clastos de brecha retrabajados en la base de la arenisca"],
                        "plane": "p2",
                    },
                    "sampleable": True,
                },
            },
        ]
    }

    names = ["Lavas Los Peumos", "Brechas El Maqui", "Areniscas La Greda"]
    ages = [("Jurásico Superior", 157.0, 150.0), ("Jurásico Superior", 150.0, 145.0), ("Cretácico Inferior", 145.0, 135.0)]
    truth = {
        "units": [
            {"key": k, "name": n, "series": "s01", "age": {"label": a[0], "from_ma": a[1], "to_ma": a[2]}}
            for k, n, a in zip(keys, names, ages)
        ],
        "column": [
            {"unit": keys[0], "base_contact": "not_exposed"},
            {"unit": keys[1], "thickness_m": TOPS[1] - TOPS[0], "base_contact": "depositional"},
            {"unit": keys[2], "base_contact": "depositional"},
        ],
        "events": [
            {"id": "e01", "type": "deposition", "rank": 1, "label": "Efusión de lavas andesíticas", "units": [keys[0]]},
            {"id": "e02", "type": "deposition", "rank": 2, "label": "Depósito de brechas volcánicas", "units": [keys[1]]},
            {"id": "e03", "type": "deposition", "rank": 3, "label": "Transgresión marina y depósito de areniscas", "units": [keys[2]]},
            {"id": "e04", "type": "tilting", "rank": 4, "label": "Basculamiento de la secuencia hacia el este"},
            {"id": "e05", "type": "erosion", "rank": 5, "label": "Alzamiento, erosión e incisión de la quebrada"},
        ],
        "map": {"encoding": "rle", "runs": runs(true_map)},
        "contacts": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": contact_trace(top)},
                    "properties": {"id": f"c{i + 1:02d}", "type": "depositional", "units": [keys[i], keys[i + 1]]},
                }
                for i, top in enumerate(TOPS)
            ],
        },
        "fold_axes": [],
        "lumpable": [],
        "key_outcrops": ["o003"],
    }
    truth["units"][0]["lab_age"] = {"method": "U-Pb", "material": "circón", "value_ma": 153.2, "error_ma": 1.1}

    def dump(obj: object) -> bytes:
        return (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

    payloads = {
        "terrain": ("terrain.bin", "u16le+gzip", "public",
                    gz(struct.pack(f"<{NX * NY}H", *(round((e - TERRAIN_OFFSET) / TERRAIN_SCALE) for e in terrain)))),
        "cover": ("cover.bin", "u8+gzip", "public", gz(bytes(cover))),
        "outcrops": ("outcrops.json", "json", "public", dump(outcrops)),
        "units": ("units.json", "json", "public", dump(units)),
        "litho": ("litho.bin", "rle8+gzip", "reveal", gz(rle8(litho))),
        "orient": ("orient.bin", "i8x3+gzip", "reveal", gz(pole_bytes * (NX * NY * NZ))),
        "truth": ("truth.json", "json", "truth", dump(truth)),
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
        "format_version": "1.0.0",
        "scenario_id": "toy-homocline",
        "variant": "a",
        "title": "Homoclinal de juguete",
        "level": 0,
        "language": "es",
        "seed": 1,
        "grid": {"nx": NX, "ny": NY, "nz": NZ, "cell_size_m": {"x": CELL, "y": CELL, "z": CELL}, "origin": ORIGIN},
        "terrain": {"scale_m": TERRAIN_SCALE, "offset_m": TERRAIN_OFFSET},
        "series": [{"key": "s01", "kind": "volcanic"}],
        "rules": {
            "field_days": 1,
            "minutes_per_day": 480,
            "sample_limit": 1,
            "scatter": {"strike_sigma_deg": 5.0, "dip_sigma_deg": 3.0, "poor_quality_factor": 2.0},
        },
        "exposure_fraction": round(len(exposed) / (NX * NY), 4),
        "files": files,
    }
    (out / "manifest.json").write_bytes(dump(manifest))


if __name__ == "__main__":
    build(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "toy")
