"""Procedural terrain and the drainage analysis shared with the exposure model."""

from __future__ import annotations

import heapq
from typing import Callable

import numpy as np
from scipy import ndimage

NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def fractal_noise(shape: tuple[int, int], rng: np.random.Generator, scale_cells: float, octaves: int = 4) -> np.ndarray:
    """Smooth random field with zero mean and unit standard deviation."""
    out = np.zeros(shape)
    for o in range(octaves):
        layer = ndimage.gaussian_filter(rng.standard_normal(shape), sigma=max(scale_cells / 2**o, 0.5), mode="reflect")
        out += layer / layer.std() * 0.5**o
    return (out - out.mean()) / out.std()


def fill_pits(elevation: np.ndarray, epsilon: float = 0.01) -> np.ndarray:
    """Priority-flood: raise closed depressions so that every cell drains to the edge."""
    h, w = elevation.shape
    filled = elevation.astype(float).copy()
    done = np.zeros((h, w), dtype=bool)
    heap: list[tuple[float, int, int]] = []
    for y in range(h):
        for x in range(w):
            if y in (0, h - 1) or x in (0, w - 1):
                heap.append((filled[y, x], y, x))
                done[y, x] = True
    heapq.heapify(heap)
    while heap:
        z, y, x = heapq.heappop(heap)
        for dy, dx in NEIGHBOURS:
            j, i = y + dy, x + dx
            if 0 <= j < h and 0 <= i < w and not done[j, i]:
                done[j, i] = True
                if filled[j, i] <= z:
                    filled[j, i] = z + epsilon
                heapq.heappush(heap, (filled[j, i], j, i))
    return filled


def flow_accumulation(elevation: np.ndarray) -> np.ndarray:
    """Number of cells draining through each cell (steepest descent to one of eight neighbours)."""
    filled = fill_pits(elevation)
    h, w = filled.shape
    acc = np.ones((h, w))
    order = np.argsort(filled, axis=None)[::-1]
    for flat in order.tolist():
        y, x = divmod(flat, w)
        best, target = 0.0, None
        for dy, dx in NEIGHBOURS:
            j, i = y + dy, x + dx
            if 0 <= j < h and 0 <= i < w:
                drop = (filled[y, x] - filled[j, i]) / (1.4142 if dy and dx else 1.0)
                if drop > best:
                    best, target = drop, (j, i)
        if target is not None:
            acc[target] += acc[y, x]
    return acc


def slope_degrees(elevation: np.ndarray, cell: float) -> np.ndarray:
    gy, gx = np.gradient(elevation, cell)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def procedural_terrain(
    shape: tuple[int, int],
    cell: float,
    params: dict,
    rng: np.random.Generator,
    surface_resistance: Callable[[np.ndarray], np.ndarray],
    fault_relief: Callable[[np.ndarray], np.ndarray] | None = None,
) -> np.ndarray:
    """Terrain where resistant rocks stand high and streams cut valleys.

    params (metres unless noted): base_m, slope_m_per_km and slope_azimuth (the
    direction the ground descends toward), relief_m (amplitude of the random
    relief), noise_scale_m, resistance_relief_m, valley_depth_m, valley_width_m.
    surface_resistance maps an elevation grid to the 0..1 resistance of the rock
    at the surface. fault_relief, when given, maps an elevation grid to the change
    of elevation the faults make there (scarps and troughs, see faultzone.py);
    it is settled with the resistance, before streams cut the valleys, so that
    streams can follow the troughs.
    """
    ny, nx = shape
    y, x = np.meshgrid((np.arange(ny) + 0.5) * cell, (np.arange(nx) + 0.5) * cell, indexing="ij")
    azimuth = np.radians(params.get("slope_azimuth", 270.0))
    along = (x - x.mean()) * np.sin(azimuth) + (y - y.mean()) * np.cos(azimuth)
    regional = params["base_m"] - along * params.get("slope_m_per_km", 0.0) / 1000.0
    noise = fractal_noise(shape, rng, params.get("noise_scale_m", 500.0) / cell, octaves=3)
    initial = regional + 0.4 * params.get("relief_m", 200.0) * noise

    # The rock at the surface depends on the surface, so settle in a few passes.
    elevation = initial
    amplitude = params.get("resistance_relief_m", 0.0)
    if amplitude or fault_relief is not None:
        for _ in range(3):
            settled = initial
            if amplitude:
                resistance = ndimage.gaussian_filter(surface_resistance(elevation), sigma=2.0, mode="nearest")
                settled = settled + amplitude * (resistance - 0.5)
            if fault_relief is not None:
                settled = settled + fault_relief(elevation)
            elevation = settled

    depth = params.get("valley_depth_m", 0.0)
    if depth:
        # Streams cut deeper where more ground drains through them. A faint
        # jitter keeps channels from running dead straight across filled lows.
        jitter = 0.4 * fractal_noise(shape, rng, 3.0, octaves=2)
        width = max(params.get("valley_width_m", 70.0) / cell, 1.0)
        passes = 3
        for _ in range(passes):
            filled = fill_pits(elevation)
            acc = flow_accumulation(filled + jitter)
            strength = np.clip(np.log(acc) / np.log(acc.size / 4.0), 0.0, 1.0) ** 2
            carve = ndimage.gaussian_filter(ndimage.maximum_filter(strength, size=3), sigma=width, mode="nearest")
            elevation = filled - depth / passes * carve / carve.max()
    return fill_pits(elevation, epsilon=0.02)
