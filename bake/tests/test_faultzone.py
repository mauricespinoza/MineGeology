"""How faults show in the land: scarps, troughs and the strip of breccia."""

import numpy as np

from geomapper_bake import faultzone
from geomapper_bake.exposure import FAULT_ZONE, expose

CELL = 10.0
N = 80


def _fault(kinematics: str, hanging_east: bool = True, sealed_north: bool = False, options=None):
    """A fault striking north through the middle of the grid; `side` is true east of it."""
    x = np.arange(N)[None, :].repeat(N, axis=0)
    side = x >= N // 2
    active = np.ones((N, N), dtype=bool)
    if sealed_north:
        active[N // 2 :, :] = False
    return faultzone.FaultSurface(kinematics, side, active, hanging_east, options or {})


def test_reverse_fault_raises_the_hanging_wall():
    d = faultzone.relief([_fault("reverse", hanging_east=True)], CELL)
    row = d[N // 4]
    assert row[N // 2 + 6] > 3.0  # the hanging wall (east) stands up near the fault
    assert row[N // 2 - 6] < -3.0  # the footwall is lower
    assert abs(row[2]) < 2.0 and abs(row[-3]) < 2.5  # and far away the land keeps its height
    # The trough of crushed rock: the trace is lower than the land just beside it on the upthrown side.
    assert row[N // 2] < row[N // 2 + 4]


def test_normal_fault_raises_the_footwall():
    d = faultzone.relief([_fault("normal", hanging_east=True)], CELL)
    row = d[N // 4]
    assert row[N // 2 - 6] > 3.0 and row[N // 2 + 6] < -3.0


def test_strike_slip_fault_makes_only_a_trough():
    d = faultzone.relief([_fault("dextral")], CELL)
    row = d[N // 4]
    assert row[N // 2] < -5.0 or row[N // 2 - 1] < -5.0
    assert abs(row[N // 2 + 8]) < 0.5 and abs(row[N // 2 - 8]) < 0.5


def test_a_sealed_fault_does_not_show():
    f = _fault("reverse", sealed_north=True)
    d = faultzone.relief([f], CELL)
    assert np.abs(d[-5]).max() < 0.5  # well inside the sealed part
    assert np.abs(d[5]).max() > 5.0
    z = faultzone.zone([f], CELL, np.random.default_rng(0))
    assert z[: N // 2].any() and not z[N // 2 :].any()


def test_zone_follows_the_trace_and_can_be_turned_off():
    z = faultzone.zone([_fault("reverse")], CELL, np.random.default_rng(1))
    cols = np.flatnonzero(z.any(axis=0))
    assert cols.min() >= N // 2 - 2 and cols.max() <= N // 2 + 1
    assert z[:, N // 2 - 1 : N // 2 + 1].mean() > 0.6  # mostly continuous, with a few gaps
    flat = faultzone.relief([_fault("reverse", options={"scarp_m": 0, "trough_m": 0})], CELL)
    assert np.abs(flat).max() == 0


def test_hanging_wall_is_found_below_the_ground():
    side_top = np.zeros((10, 10), dtype=bool)
    side_top[:, 5:] = True
    side_below = np.zeros((10, 10), dtype=bool)
    side_below[:, 7:] = True  # the plane dips east: below cells 5 and 6 one crosses into the other side
    assert faultzone.hanging_wall(side_top, side_below, np.ones((10, 10), dtype=bool)) is True
    assert faultzone.hanging_wall(side_top, side_top, np.ones((10, 10), dtype=bool)) is None


def test_exposure_draws_fault_breccia_but_keeps_outcrops_and_valley_floors():
    rng = np.random.default_rng(3)
    y, x = np.indices((N, N))
    elevation = 500 + 3.0 * x + 2.0 * np.sin(y / 5.0) * 10
    cells = np.zeros((N, N), dtype=bool)
    cells[:, 38:42] = True
    e = expose(elevation, CELL, np.full((N, N), 0.5), rng, fault_cells=cells)
    assert (e.cover == FAULT_ZONE).any()
    assert not (e.cover == FAULT_ZONE)[~cells].any()
    assert ((e.cover == FAULT_ZONE) | (e.cover == 0) | (e.cover == 2))[cells].all()
