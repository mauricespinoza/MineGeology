"""Exposure model: where bedrock crops out, and what covers the rest."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

from .terrain import flow_accumulation, fractal_noise, slope_degrees

BARE_ROCK, SOIL, ALLUVIUM, SCREE, VEGETATION = range(5)
COVER_NAMES = ("bare_rock", "soil", "alluvium", "scree", "vegetation")
DEFAULTS = {
    "target_fraction": 0.05,
    "max_outcrop_cells": 6,  # outcrops are cut into tiles of this many cells a side
    "patch_scale_cells": 3.0,
    "weights": {"slope": 0.35, "ridge": 0.25, "stream": 0.30, "noise": 0.45, "dyke": 0.10},
}


@dataclass
class Exposure:
    cover: np.ndarray  # (ny, nx) cover class
    labels: np.ndarray  # (ny, nx) outcrop number from 1, 0 where covered
    fraction: float
    score: np.ndarray


def expose(
    elevation: np.ndarray,
    cell: float,
    resistance: np.ndarray,
    rng: np.random.Generator,
    options: dict | None = None,
    dyke_cells: np.ndarray | None = None,
) -> Exposure:
    """resistance: (ny, nx) 0..1 resistance of the bedrock at the surface."""
    opt = {**DEFAULTS, **(options or {})}
    weights = {**DEFAULTS["weights"], **opt.get("weights", {})}
    shape = elevation.shape

    slope = slope_degrees(elevation, cell)
    acc = flow_accumulation(elevation)
    window = max(int(round(90.0 / cell)) | 1, 3)
    position = elevation - ndimage.uniform_filter(elevation, size=window, mode="nearest")
    stream = acc > max(shape[0] * shape[1] / 300.0, 8.0)
    valley_floor = ndimage.binary_dilation(stream & (slope < 8.0)) & (slope < 10.0)

    steep = np.clip(slope / 35.0, 0.0, 1.0)
    ridge = np.clip(position / (2.0 * position.std() + 1e-9), 0.0, 1.0)
    incised = ndimage.gaussian_filter(stream.astype(float), sigma=1.0) * np.sqrt(steep)
    incised /= incised.max() + 1e-9
    patches = fractal_noise(shape, rng, opt["patch_scale_cells"], octaves=2)

    score = (weights["slope"] * steep + weights["ridge"] * ridge + weights["stream"] * incised) * (
        0.65 + 0.35 * resistance
    ) + weights["noise"] * 0.3 * patches
    if dyke_cells is not None:
        score = score + weights["dyke"] * dyke_cells
    score = np.where(valley_floor, -np.inf, score)

    wanted = int(round(opt["target_fraction"] * score.size))
    finite = np.sort(score[np.isfinite(score)])
    threshold = finite[-wanted] if 0 < wanted <= finite.size else np.inf
    exposed = score >= threshold

    # Cover for everything else.
    gy, gx = np.gradient(elevation, cell)
    aspect = np.degrees(np.arctan2(-gx, -gy)) % 360.0  # the direction the slope faces
    shaded = (aspect > 110.0) & (aspect < 250.0)  # south-facing: wetter in central Chile
    greenery = fractal_noise(shape, rng, 6.0, octaves=2)
    near_rock = ndimage.binary_dilation(exposed, iterations=2)
    cover = np.full(shape, SOIL, dtype=np.uint8)
    cover[(shaded & (slope > 6.0) & (greenery > -0.2)) | (ndimage.binary_dilation(stream, iterations=1) & (greenery > 0.3))] = VEGETATION
    cover[near_rock & (slope > 24.0)] = SCREE
    cover[valley_floor] = ALLUVIUM
    cover[exposed] = BARE_ROCK

    # Outcrops: connected patches of rock, cut into tiles so that none sprawls.
    tile = opt["max_outcrop_cells"]
    yy, xx = np.indices(shape)
    components, _ = ndimage.label(exposed)
    keyed = (components * 10_000 + (yy // tile) * 100 + (xx // tile)) * exposed
    labels = np.zeros(shape, dtype=int)
    count = 0
    for key in np.unique(keyed[exposed]):
        pieces, n = ndimage.label(keyed == key)
        labels[pieces > 0] = pieces[pieces > 0] + count
        count += n
    # Number them from the south-west so that ids do not depend on labelling order.
    first = ndimage.minimum(yy * shape[1] + xx, labels, index=np.arange(1, count + 1)) if count else []
    rank = np.zeros(count + 1, dtype=int)
    rank[1:][np.argsort(first)] = np.arange(1, count + 1)
    labels = rank[labels]
    return Exposure(cover=cover, labels=labels, fraction=float(exposed.mean()), score=score)
