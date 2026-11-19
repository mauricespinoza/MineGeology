"""How a fault shows in the landscape: a scarp, a trough of crushed rock and a strip of breccia.

A student who has not yet found the fault plane in an outcrop should still be able to suspect a fault from the
land, as in the field or on an air photo:

- a scarp: the upthrown block stands higher for a few hundred metres from the trace (the hanging wall for a
  reverse fault or a thrust, the footwall for a normal fault; none for a strike-slip fault);
- a trough along the trace, where crushed rock erodes faster: aligned saddles and a straight valley that streams
  then follow;
- a strip of crushed and brecciated rock along the trace, a cover class of its own (``fault_zone``).

The fault is only expressed where it offsets the rock at the surface: under younger beds that seal it there is
nothing to see, and the expression fades out over a few cells at the edge of the sealed area.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

DEFAULTS = {
    "scarp_m": 20.0,  # height of the step on the upthrown side
    "scarp_width_m": 18.0,  # horizontal width of the steep part
    "scarp_decay_m": 220.0,  # distance over which the step fades back into the land
    "trough_m": 8.0,  # depth of the trough of crushed rock
    "trough_width_m": 16.0,
    "zone_width_m": 25.0,  # full width of the strip of fault breccia on the map
}
# Which block goes up, by kinematics: +1 the hanging wall, -1 the footwall, 0 neither.
UPTHROWN = {"reverse": 1, "thrust": 1, "normal": -1, "oblique": 0, "dextral": 0, "sinistral": 0}
PROBE_M = 60.0  # how far below the ground to look for the fault plane, to tell the hanging wall


@dataclass
class FaultSurface:
    """One fault where it meets a surface grid."""

    kinematics: str
    side: np.ndarray  # (ny, nx) bool, which side of the fault plane each cell lies on
    active: np.ndarray  # (ny, nx) bool, the rock there is offset by this fault
    hanging: bool | None  # the value of `side` on the hanging wall; None when it cannot be told
    options: dict


def trace_cells(side: np.ndarray, active: np.ndarray) -> np.ndarray:
    """Cells next to the fault trace: the side changes to a neighbour and both are offset by the fault."""
    out = np.zeros(side.shape, dtype=bool)
    for axis in (0, 1):
        lo = [slice(None)] * 2
        hi = [slice(None)] * 2
        lo[axis], hi[axis] = slice(0, -1), slice(1, None)
        lo, hi = tuple(lo), tuple(hi)
        edge = (side[lo] != side[hi]) & active[lo] & active[hi]
        out[lo] |= edge
        out[hi] |= edge
    return out


def _signed_distance(side: np.ndarray, cell: float) -> np.ndarray:
    """Distance in metres to the fault plane's line on the surface, positive on the side where `side` is true."""
    if side.all() or not side.any():
        return np.full(side.shape, np.inf)
    inside = ndimage.distance_transform_edt(side) - 0.5
    outside = ndimage.distance_transform_edt(~side) - 0.5
    return np.where(side, inside, -outside) * cell


def hanging_wall(side_top: np.ndarray, side_below: np.ndarray, active: np.ndarray) -> bool | None:
    """The side of the hanging wall: going straight down from it, one crosses the fault plane."""
    crossed = (side_top != side_below) & active
    if crossed.sum() < 3:
        return None
    return bool(side_top[crossed].mean() > 0.5)


def relief(faults: list[FaultSurface], cell: float) -> np.ndarray:
    """Change of elevation, in metres, that the faults make in the land."""
    shape = faults[0].side.shape if faults else (1, 1)
    delta = np.zeros(shape)
    for f in faults:
        if not trace_cells(f.side, f.active).any():
            continue
        o = {**DEFAULTS, **f.options}
        u = _signed_distance(f.side, cell)
        if not np.isfinite(u).any():
            continue
        # The expression fades where younger rock seals the fault.
        weight = ndimage.gaussian_filter(f.active.astype(float), sigma=3.0, mode="nearest")
        up = UPTHROWN.get(f.kinematics, 0)
        d = np.zeros(shape)
        if up and f.hanging is not None:
            sign = 1.0 if f.hanging else -1.0  # positive u now on the hanging wall
            uu = u * sign * up  # positive on the upthrown block
            d += o["scarp_m"] * 0.5 * (1.0 + np.tanh(uu / o["scarp_width_m"])) * np.exp(-np.maximum(uu, 0.0) / o["scarp_decay_m"])
            # The step is centred so that the land far from the fault keeps its height on both sides.
            d -= o["scarp_m"] * 0.5 * np.exp(-np.abs(uu) / o["scarp_decay_m"])
        d -= o["trough_m"] * np.exp(-((u / o["trough_width_m"]) ** 2))
        delta += weight * d
    return delta


def zone(faults: list[FaultSurface], cell: float, rng: np.random.Generator) -> np.ndarray:
    """Cells of the strip of fault breccia, broken here and there by soil washed over it."""
    shape = faults[0].side.shape if faults else (1, 1)
    out = np.zeros(shape, dtype=bool)
    for f in faults:
        edge = trace_cells(f.side, f.active)
        if not edge.any():
            continue
        half = {**DEFAULTS, **f.options}["zone_width_m"] / 2.0
        near = ndimage.distance_transform_edt(~edge) * cell <= max(half - cell / 2.0, 0.0)
        out |= (edge | near) & f.active
    if out.any():
        gaps = ndimage.gaussian_filter(rng.standard_normal(shape), sigma=2.5)
        out &= gaps > -1.1 * gaps.std()
    return out
