"""Cerro Pizarras (level 2).

Analogue: the Coastal Cordillera near Concepción. A Paleozoic metaturbidite
basement (slates over metasandstones) with a regional foliation, intruded by a
Late Carboniferous granodiorite stock that baked a hornfels aureole around it
(the aureole is added by the bake from scenario.yaml), all under an angular
unconformity with gently tilted continental Triassic beds.
"""

import numpy as np

from geomapper_bake.authoring import element, geomodel, pole_from_strike_dip, series


def warp(x, y, amplitude):
    """Open undulation of the foliation, so its attitude changes across the area."""
    return amplitude * np.sin(2 * np.pi * (x + 0.6 * y) / 2600.0)


def foliation_surface(x, y, height, ctx):
    p = ctx.params
    xmin, xmax, ymin, ymax, *_ = ctx.extent
    centre = np.array([(xmin + xmax) / 2, (ymin + ymax) / 2, p["reference_elevation"]])
    pole = pole_from_strike_dip(p["foliation_strike"], p["foliation_dip"])
    through = centre + height * pole
    return through[2] - ((x - through[0]) * pole[0] + (y - through[1]) * pole[1]) / pole[2] + warp(x, y, p["warp_m"])


def foliation_pole(x, y, ctx):
    h = 5.0
    dzdx = (foliation_surface(x + h, y, 0.0, ctx) - foliation_surface(x - h, y, 0.0, ctx)) / (2 * h)
    dzdy = (foliation_surface(x, y + h, 0.0, ctx) - foliation_surface(x, y - h, 0.0, ctx)) / (2 * h)
    n = np.array([-dzdx, -dzdy, 1.0])
    return n / np.linalg.norm(n)


def cover_surface(x, y, height, ctx):
    """Base of a Triassic unit: a plane tilted gently, `height` metres above the unconformity."""
    p = ctx.params
    xmin, xmax, ymin, ymax, *_ = ctx.extent
    pole = pole_from_strike_dip(p["cover_strike"], p["cover_dip"])
    through = np.array([(xmin + xmax) / 2, (ymin + ymax) / 2, p["unconformity_elevation"]]) + height * pole
    return through[2] - ((x - through[0]) * pole[0] + (y - through[1]) * pole[1]) / pole[2]


def build_model(ctx):
    p = ctx.params
    xmin, xmax, ymin, ymax, zmin, zmax = ctx.extent
    xs = np.linspace(xmin, xmax, 6)[1:-1]
    ys = np.linspace(ymin, ymax, 6)[1:-1]
    grid = np.array([(x, y) for x in xs for y in ys])

    # Triassic cover, youngest first: sandstones over basal conglomerates.
    cover_pole = pole_from_strike_dip(p["cover_strike"], p["cover_dip"])
    cover = []
    for name, height in (("areniscas", p["conglomerate_m"]), ("conglomerados", 0.0)):
        z = cover_surface(grid[:, 0], grid[:, 1], height, ctx)
        pts = np.column_stack([grid, z])
        cover.append(element(name, pts, [(*pts[5], *cover_pole)]))

    # The stock: a dome whose roof stands above the ground, with steep walls.
    cx, cy, top, a, b = p["stock_x"], p["stock_y"], p["stock_top"], p["stock_a"], p["stock_b"]
    ring = []
    for r in (0.35, 0.7, 1.0):
        for t in np.linspace(0, 2 * np.pi, 10, endpoint=False):
            x, y = cx + r * a * np.cos(t), cy + r * b * np.sin(t)
            z = top - p["stock_drop"] * r**2
            # Inward normal of z = top - drop * ((x - cx)^2 / a^2 + (y - cy)^2 / b^2).
            g = np.array([2 * p["stock_drop"] * (x - cx) / a**2, 2 * p["stock_drop"] * (y - cy) / b**2, 1.0])
            ring.append((x, y, z, *(-g / np.linalg.norm(g))))
    ring = np.array(ring)
    stock = element("granodiorita", ring[:, :3], ring[::3])

    # Metamorphic basement: slates over metasandstones (GemPy's basement).
    z = foliation_surface(grid[:, 0], grid[:, 1], 0.0, ctx)
    keep = (z > zmin - 400.0) & (z < zmax + 400.0)
    pts = np.column_stack([grid[keep], z[keep]])
    slates = element("pizarras", pts, [(x, y, zz, *foliation_pole(x, y, ctx)) for x, y, zz in pts[::3]])

    return geomodel(ctx, [series("triasico", cover), series("intrusivo", [stock]), series("basamento", [slates])])
