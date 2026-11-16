"""Test scenario: a planar homocline. Three units, one series, no faults."""

import numpy as np

from geomapper_bake.authoring import element, geomodel, plane_points, pole_from_strike_dip, series

# Stratigraphic height of each unit's base above the centre of the block, in metres.
BASES = {"areniscas": 35.0, "brechas": -15.0}


def build_model(ctx):
    xmin, xmax, ymin, ymax, zmin, zmax = ctx.extent
    centre = np.array([(xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2])
    pole = pole_from_strike_dip(ctx.params["strike"], ctx.params["dip"])
    xy = [(x, y) for x in np.linspace(xmin, xmax, 4)[1:3] for y in np.linspace(ymin, ymax, 4)[1:3]]
    xy.append(centre[:2])

    elements = []
    for name, height in BASES.items():  # youngest first
        through = centre + height * pole
        orientation = [(*through, *pole)] if not elements else []
        elements.append(element(name, plane_points(through, pole, xy), orientation))
    return geomodel(ctx, [series("secuencia", elements)])


def build_terrain(x, y, ctx):
    """A slope rising to the east, cut by an east-west valley."""
    return 1070.0 + 0.08 * (x - 160.0) - 25.0 * np.exp(-(((y - 160.0) / 50.0) ** 2))
