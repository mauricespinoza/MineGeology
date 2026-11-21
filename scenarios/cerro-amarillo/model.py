"""Cerro Amarillo (pilot of an ore-deposit scenario: a porphyry copper system).

Analogue: the Miocene porphyry Cu-Mo belt of the Main Cordillera of central Chile, where porphyry
systems intrude the Cenozoic intra-arc volcanic and volcaniclastic fill (Abanico and Farellones style)
and sit where arc-parallel faults meet NW-striking transverse faults.

The geology is that of an inverted half-graben, as in Estero Las Tobas: tuffs, volcaniclastic
sandstones and andesitic lavas that thicken toward an east-dipping border fault, later reactivated
as a reverse fault. A NW-striking transverse fault with a small normal throw cuts the fill. A
granodiorite stock and, inside its top, a dacite porphyry elongated along the transverse fault
intrude where the two faults cross, and neither is displaced: they seal both faults.

The hydrothermal alteration is not a unit: the bake lays it over the rock (`alteration:` in
scenario.yaml), as shells around the porphyry and channels along the faults. Post-mineral dykes,
parallel to the transverse fault, are added by the bake too.

GemPy would smooth the growth wedge (see Estero Las Tobas), so this model is analytic.
"""

import math

import numpy as np

from geomapper_bake.authoring import AnalyticModel
from geomapper_bake.runner import Group

FILL = ["lavas", "areniscas", "tobas"]  # youngest first
# Base of each fill unit: hanging wall (elevation at the border fault, rise per metre away from it), footwall.
HANGING = {"lavas": (2950.0, 0.04), "areniscas": (2600.0, 0.12), "tobas": (2200.0, 0.22)}
FOOT = {"lavas": 2840.0, "areniscas": 2780.0, "tobas": 2700.0}


class Model(AnalyticModel):
    def __init__(self, ctx):
        self.p = ctx.params
        # Youngest first; faults before what they cut. Each intrusion is a series of its own,
        # so that the porphyry's contact with the stock is intrusive.
        self.groups = [
            Group("porfido", False, ("porfido",), ()),
            Group("intrusivo", False, ("granodiorita",), ()),
            Group("falla_nw", True, ("falla_nw",), (4,)),
            Group("falla", True, ("falla",), (4,)),
            Group("relleno", False, tuple(FILL), ()),
        ]
        self.elements = ["porfido", "granodiorita", *FILL, "basement"]

    # --- geometry -----------------------------------------------------------
    def fault_x(self, y, z):
        """The border fault: x of its plane at y and elevation z. It dips east."""
        p = self.p
        bend = p["fault_bend_m"] * np.sin(2 * np.pi * y / 2600.0)
        return p["fault_x"] + bend + (p["fault_z"] - z) / math.tan(math.radians(p["fault_dip"]))

    def nw_distance(self, x, y, z):
        """Signed distance to the transverse fault, positive on its hanging wall (to the north-east)."""
        p = self.p
        strike, dip = math.radians(p["nw_strike"]), math.radians(p["nw_dip"])
        across = np.array([math.sin(strike + math.pi / 2), math.cos(strike + math.pi / 2)])  # dip direction
        u = (x - p["nw_x"]) * across[0] + (y - p["nw_y"]) * across[1]
        return (u - (p["fault_z"] - z) / math.tan(dip)) * math.sin(dip)

    def bases(self, x, y, z):
        """Base elevation of each fill unit at these points, youngest first: (3, n)."""
        p = self.p
        xf = self.fault_x(y, z)
        hanging = x > xf
        d = np.abs(x - xf)
        harpoon = p["harpoon_m"] * np.exp(-d / p["harpoon_width_m"])
        tilt = p["basin_tilt"] * (y - 1280.0)
        drop = np.where(self.nw_distance(x, y, z) > 0, p["nw_throw_m"], 0.0)  # normal throw: the NE block is down
        out = []
        for name in FILL:
            z0, rise = HANGING[name]
            hw = z0 + rise * d + harpoon + tilt
            fw = FOOT[name] + p["footwall_dip"] * d
            out.append(np.where(hanging, hw, fw) - drop)
        return np.array(out)

    def stock(self, xyz):
        p = self.p
        r2 = ((xyz[:, 0] - p["stock_x"]) ** 2 + (xyz[:, 1] - p["stock_y"]) ** 2) / p["stock_r"] ** 2
        return p["stock_top"] - p["stock_drop"] * r2 - xyz[:, 2]

    def porphyry(self, xyz):
        """An elliptical, steep-sided body, its long axis along the transverse fault."""
        p = self.p
        a = math.radians(p["nw_strike"])
        dx, dy = xyz[:, 0] - p["porphyry_x"], xyz[:, 1] - p["porphyry_y"]
        along = dx * math.sin(a) + dy * math.cos(a)
        across = dx * math.cos(a) - dy * math.sin(a)
        r2 = (along / p["porphyry_long"]) ** 2 + (across / p["porphyry_short"]) ** 2
        return p["porphyry_top"] - p["porphyry_drop"] * r2 - xyz[:, 2]

    # --- AnalyticModel ------------------------------------------------------
    def classify(self, xyz):
        x, y, z = xyz.T
        b = self.bases(x, y, z)
        unit = np.full(len(x), len(FILL) + 2)  # basement
        for k in reversed(range(len(FILL))):  # oldest first, younger units overwrite
            unit = np.where(z >= b[k], k + 2, unit)
        unit = np.where(self.stock(xyz) > 0, 1, unit)
        return np.where(self.porphyry(xyz) > 0, 0, unit)

    def scalar(self, i, xyz):
        x, y, z = xyz.T
        if i == 0:
            return self.porphyry(xyz)
        if i == 1:
            return self.stock(xyz)
        if i == 2:
            return self.nw_distance(x, y, z)
        if i == 3:
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
