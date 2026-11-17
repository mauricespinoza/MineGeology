"""Quebrada Los Litres (level 1).

Analogue: the Jurassic to Lower Cretaceous volcano-sedimentary pile of the
Coastal Cordillera of central Chile. An east-dipping homocline of lavas,
breccias, marine beds and red beds, gently warped, later cut by dykes (the
dykes are added by the bake from scenario.yaml).
"""

import numpy as np

from geomapper_bake.authoring import element, geomodel, pole_from_strike_dip, series

# Base of each unit as stratigraphic height above the reference point, in metres.
# Youngest first; the lowest unit is GemPy's basement.
BASES = {"capas_rojas": 430.0, "ocoitas": 120.0, "marinas": -60.0, "brechas": -330.0}


def warp(x, y, amplitude):
    """Gentle undulation of the beds, so strike and dip vary by a few degrees across the area."""
    return amplitude * (np.sin(2 * np.pi * y / 3600.0) + 0.5 * np.cos(2 * np.pi * x / 3000.0))


def bed_surface(x, y, height, ctx):
    """Elevation of the bed at stratigraphic height `height` above the reference point."""
    xmin, xmax, ymin, ymax, zmin, zmax = ctx.extent
    centre = np.array([(xmin + xmax) / 2, (ymin + ymax) / 2, ctx.params["reference_elevation"]])
    pole = pole_from_strike_dip(ctx.params["strike"], ctx.params["dip"])
    through = centre + height * pole
    plane = through[2] - ((x - through[0]) * pole[0] + (y - through[1]) * pole[1]) / pole[2]
    return plane + warp(x, y, ctx.params["warp_m"])


def bed_pole(x, y, ctx):
    """Upward normal of the warped beds at x, y."""
    step = 5.0
    dzdx = (bed_surface(x + step, y, 0.0, ctx) - bed_surface(x - step, y, 0.0, ctx)) / (2 * step)
    dzdy = (bed_surface(x, y + step, 0.0, ctx) - bed_surface(x, y - step, 0.0, ctx)) / (2 * step)
    normal = np.array([-dzdx, -dzdy, 1.0])
    return normal / np.linalg.norm(normal)


def build_model(ctx):
    xmin, xmax, ymin, ymax, zmin, zmax = ctx.extent
    xs = np.linspace(xmin, xmax, 6)[1:-1]
    ys = np.linspace(ymin, ymax, 6)[1:-1]
    grid = np.array([(x, y) for x in xs for y in ys])

    elements = []
    for name, height in BASES.items():
        z = bed_surface(grid[:, 0], grid[:, 1], height, ctx)
        # Keep the control points that fall inside the block, with a margin.
        keep = (z > zmin - 400.0) & (z < zmax + 400.0)
        points = np.column_stack([grid[keep], z[keep]])
        orientations = [(x, y, zz, *bed_pole(x, y, ctx)) for x, y, zz in points[:: max(len(points) // 5, 1)]]
        elements.append(element(name, points, orientations))
    return geomodel(ctx, [series("secuencia", elements)])
