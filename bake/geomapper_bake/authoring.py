"""Small helpers for scenario model.py files. Optional: plain GemPy works just as well."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Sequence

import numpy as np


@dataclass(frozen=True)
class BakeContext:
    """What the bake passes to build_model and build_terrain.

    Model coordinates: x east and y north in metres from the south-west corner
    of the area, z as elevation in metres.
    """

    extent: tuple[float, float, float, float, float, float]  # xmin, xmax, ymin, ymax, zmin, zmax
    params: dict[str, Any] = field(default_factory=dict)
    seed: int = 0


def pole_from_strike_dip(strike: float, dip: float, overturned: bool = False) -> np.ndarray:
    """Unit vector (east, north, up) normal to a plane, pointing toward younger beds.

    Strike follows the right-hand rule: the plane dips toward strike + 90.
    """
    direction = math.radians(strike + 90.0)
    d = math.radians(dip)
    pole = np.array([math.sin(d) * math.sin(direction), math.sin(d) * math.cos(direction), math.cos(d)])
    return -pole if overturned else pole


def strike_dip_from_pole(pole: Sequence[float]) -> tuple[float, float, bool]:
    """Inverse of pole_from_strike_dip: strike, dip, overturned."""
    e, n, u = (float(c) for c in pole)
    overturned = u < 0
    if overturned:
        e, n, u = -e, -n, -u
    dip = math.degrees(math.acos(max(-1.0, min(1.0, u / math.sqrt(e * e + n * n + u * u)))))
    strike = (math.degrees(math.atan2(e, n)) - 90.0) % 360.0 if dip > 1e-9 else 0.0
    return strike, dip, overturned


def plane_points(through: Sequence[float], pole: Sequence[float], xy: Sequence[Sequence[float]]) -> np.ndarray:
    """Points (x, y, z) on the plane through `through` with normal `pole`, at the given x, y."""
    p0 = np.asarray(through, dtype=float)
    n = np.asarray(pole, dtype=float)
    xy = np.asarray(xy, dtype=float)
    z = p0[2] - ((xy[:, 0] - p0[0]) * n[0] + (xy[:, 1] - p0[1]) * n[1]) / n[2]
    return np.column_stack([xy, z])


def element(name: str, points: Sequence[Sequence[float]], orientations: Sequence[Sequence[float]] = ()):
    """A GemPy StructuralElement from points (x, y, z) and orientations (x, y, z, pole east, north, up).

    In GemPy the points of an element lie on its base.
    """
    import gempy as gp

    p = np.asarray(points, dtype=float)
    surface_points = gp.data.SurfacePointsTable.from_arrays(x=p[:, 0], y=p[:, 1], z=p[:, 2], names=name)
    if len(orientations):
        o = np.asarray(orientations, dtype=float)
        table = gp.data.OrientationsTable.from_arrays(
            x=o[:, 0], y=o[:, 1], z=o[:, 2], G_x=o[:, 3], G_y=o[:, 4], G_z=o[:, 5], names=name
        )
    else:
        table = gp.data.OrientationsTable.initialize_empty()
    return gp.data.StructuralElement(name=name, surface_points=surface_points, orientations=table, color="#888888")


def series(name: str, elements: list, onlap: bool = False):
    """A stratified or intrusive series; elements are listed youngest first."""
    import gempy as gp

    relation = gp.data.StackRelationType.ONLAP if onlap else gp.data.StackRelationType.ERODE
    return gp.data.StructuralGroup(name=name, elements=elements, structural_relation=relation)


def fault(name: str, surface, offsets: list | None = None):
    """A fault group. `offsets` lists the series it displaces; by default every group below it."""
    import gempy as gp

    relation = offsets if offsets else gp.data.FaultsRelationSpecialCase.OFFSET_ALL
    return gp.data.StructuralGroup(
        name=name, elements=[surface], structural_relation=gp.data.StackRelationType.FAULT, fault_relations=relation
    )


def geomodel(ctx: BakeContext, groups: list):
    """A GemPy GeoModel over the bake extent; groups are listed youngest first, faults before what they cut."""
    import gempy as gp

    frame = gp.data.StructuralFrame(structural_groups=groups, color_gen=gp.data.ColorsGenerator())
    return gp.create_geomodel(project_name="scenario", extent=list(ctx.extent), refinement=1, structural_frame=frame)


class AnalyticModel:
    """Base for a model.py that evaluates its geology with formulas instead of GemPy.

    Use it where GemPy cannot express a structure. Subclasses set `groups`
    (runner.Group, youngest first, faults before what they cut, the same order
    as for GemPy) and `elements` (rock names, youngest first, ending with
    "basement"), and implement:

    - classify(xyz) -> index into `elements` per point;
    - scalar(i, xyz) -> the field of group i: for a fault, the signed distance
      to its plane (positive on the hanging wall, threshold 0); for a series, a
      value that increases toward younger rock, so that its gradient is the
      bedding pole.
    """

    groups: list = []
    elements: list[str] = []

    @property
    def element_group(self) -> dict[str, int]:
        found = {e: i for i, g in enumerate(self.groups) for e in g.elements}
        last = max(i for i, g in enumerate(self.groups) if not g.is_fault)
        return {e: found.get(e, last) for e in self.elements}

    def classify(self, xyz: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def scalar(self, i: int, xyz: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def evaluate(self, xyz: np.ndarray):
        from .runner import Evaluation

        xyz = np.asarray(xyz, dtype=float)
        scalar, gradient, threshold = [], [], []
        h = 2.0
        for i in range(len(self.groups)):
            scalar.append(self.scalar(i, xyz))
            parts = []
            for axis in range(3):
                step = np.zeros(3)
                step[axis] = h
                parts.append((self.scalar(i, xyz + step) - self.scalar(i, xyz - step)) / (2 * h))
            gradient.append(np.stack(parts, axis=1))
            threshold.append(np.array([0.0]))
        return Evaluation(element=self.classify(xyz), scalar=scalar, gradient=gradient, threshold=threshold)
