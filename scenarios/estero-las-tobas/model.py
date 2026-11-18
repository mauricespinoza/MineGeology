"""Estero Las Tobas (level 4).

Analogue: the Cenozoic intra-arc basins of the Main Cordillera (Abanico and
Cura-Mallín style). A half-graben filled with tuffs, volcaniclastic sandstones
and ignimbrites that thicken toward an east-dipping normal fault. The fault was
later reactivated as a reverse fault: the hanging wall was pushed back up and
bent into a harpoon anticline against it, so the oldest fill still shows a
normal separation and the youngest a reverse one. A Miocene stock intrudes
across the fault and is not displaced: it dates the end of the inversion.

GemPy smooths the jump in thickness across the fault into a broad warp, so this
model is analytic (geomapper_bake.authoring.AnalyticModel).
"""

import math

import numpy as np

from geomapper_bake.authoring import AnalyticModel
from geomapper_bake.runner import Group

FILL = ["ignimbritas", "areniscas", "tobas"]  # youngest first
# Base of each fill unit: hanging wall (elevation at the fault, rise per metre away from it), footwall (elevation at the fault).
HANGING = {"ignimbritas": (2950.0, 0.04), "areniscas": (2600.0, 0.12), "tobas": (2200.0, 0.22)}
FOOT = {"ignimbritas": 2840.0, "areniscas": 2780.0, "tobas": 2700.0}


class Model(AnalyticModel):
    def __init__(self, ctx):
        self.p = ctx.params
        self.groups = [
            Group("intrusivo", False, ("granodiorita",), ()),
            Group("falla", True, ("falla",), (2,)),
            Group("relleno", False, tuple(FILL), ()),
        ]
        self.elements = ["granodiorita", *FILL, "basement"]

    # --- geometry -----------------------------------------------------------
    def fault_x(self, y, z):
        p = self.p
        bend = p["fault_bend_m"] * np.sin(2 * np.pi * y / 2600.0)
        return p["fault_x"] + bend + (p["fault_z"] - z) / math.tan(math.radians(p["fault_dip"]))

    def bases(self, x, y, z):
        """Base elevation of each fill unit at these points, youngest first: (3, n)."""
        p = self.p
        xf = self.fault_x(y, z)
        hanging = x > xf
        d = np.abs(x - xf)
        harpoon = p["harpoon_m"] * np.exp(-d / p["harpoon_width_m"])
        tilt = p["basin_tilt"] * (y - 1280.0)
        out = []
        for name in FILL:
            z0, rise = HANGING[name]
            hw = z0 + rise * d + harpoon + tilt
            fw = FOOT[name] + p["footwall_dip"] * d
            out.append(np.where(hanging, hw, fw))
        return np.array(out)

    def stock(self, xyz):
        p = self.p
        r2 = ((xyz[:, 0] - p["stock_x"]) ** 2 + (xyz[:, 1] - p["stock_y"]) ** 2) / p["stock_r"] ** 2
        return p["stock_top"] - p["stock_drop"] * r2 - xyz[:, 2]

    # --- AnalyticModel ------------------------------------------------------
    def classify(self, xyz):
        x, y, z = xyz.T
        b = self.bases(x, y, z)
        unit = np.full(len(x), len(FILL) + 1)  # basement
        for k in reversed(range(len(FILL))):  # oldest first, younger units overwrite
            unit = np.where(z >= b[k], k + 1, unit)
        return np.where(self.stock(xyz) > 0, 0, unit)

    def scalar(self, i, xyz):
        x, y, z = xyz.T
        if i == 0:
            return self.stock(xyz)
        if i == 1:
            dip = math.radians(self.p["fault_dip"])
            return (x - self.fault_x(y, z)) * math.sin(dip)
        # Stratigraphic position: piecewise linear between the bases, so its gradient is the bedding pole.
        b = self.bases(x, y, z)[::-1]  # oldest first
        below = np.vstack([b[0] - 300.0, b])
        above = np.vstack([b, b[-1:] + 300.0])
        level = np.zeros(len(x))
        for k in range(len(below)):
            lo, hi = below[k], above[k]
            inside = (z >= lo) & (z < hi)
            level = np.where(inside, k + (z - lo) / np.maximum(hi - lo, 1.0), level)
        level = np.where(z >= above[-1], len(below) + (z - above[-1]) / 300.0, level)
        return np.where(z < below[0], (z - below[0]) / 300.0, level)


def build_analytic(ctx):
    return Model(ctx)
