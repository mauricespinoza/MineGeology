"""Test scenario: tilted beds cut by a reverse fault, both sealed by a flat volcanic cover."""

import math

import numpy as np

from geomapper_bake.authoring import element, fault, geomodel, plane_points, pole_from_strike_dip, series

BED_POLE = pole_from_strike_dip(0.0, 20.0)  # beds dip 20 degrees east
FAULT_POLE = pole_from_strike_dip(0.0, 70.0)  # fault dips 70 degrees east
FAULT_THROUGH = np.array([320.0, 320.0, 1160.0])
THROW = 40.0  # the eastern (hanging-wall) block is up: reverse
COVER_BASE = 1245.0  # between cell centres, so no cell sits exactly on it
BASES = {"b": 260.0, "a": 160.0}  # stratigraphic height of each base, west of the fault


def east_of_fault(x, z):
    return (x - FAULT_THROUGH[0]) * FAULT_POLE[0] + (z - FAULT_THROUGH[2]) * FAULT_POLE[2] > 0


def bed_height(x, z):
    """Stratigraphic height of a point, undoing the fault."""
    z = np.where(east_of_fault(x, z), z - THROW, z)
    return x * BED_POLE[0] + (z - 1000.0) * BED_POLE[2]


def build_model(ctx):
    xy = [(x, y) for x in (60.0, 180.0, 260.0, 400.0, 480.0, 580.0) for y in (100.0, 540.0)]
    beds = []
    for name, height in BASES.items():  # youngest first
        through = np.array([0.0, 0.0, 1000.0 + height / BED_POLE[2]])
        points = plane_points(through, BED_POLE, xy)
        points[:, 2] += np.where(east_of_fault(points[:, 0], points[:, 2]), THROW, 0.0)
        orientation = [(*points[0], *BED_POLE)] if not beds else []
        beds.append(element(name, points, orientation))
    strata = series("estratos", beds)

    corners = [(x, y) for x in (100.0, 540.0) for y in (100.0, 540.0)]
    cover = series(
        "cubierta",
        [element("ignimbrita", [(x, y, COVER_BASE) for x, y in corners], [(320.0, 320.0, COVER_BASE, 0.0, 0.0, 1.0)])],
    )

    cot = FAULT_POLE[2] / FAULT_POLE[0]
    on_fault = [(FAULT_THROUGH[0] - (z - FAULT_THROUGH[2]) * cot, y, z) for z in (1060.0, 1160.0, 1260.0) for y in (100.0, 540.0)]
    falla = fault("falla", element("falla", on_fault, [(*FAULT_THROUGH, *FAULT_POLE)]), offsets=[strata])
    return geomodel(ctx, [falla, cover, strata])


def build_terrain(x, y, ctx):
    """High ground in the north keeps its cover; the south is eroded into the beds."""
    return 1215.0 - 55.0 * np.sin(2.0 * math.pi * y / 640.0) + 0.0 * x
