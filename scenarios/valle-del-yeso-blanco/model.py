"""Valle del Yeso Blanco (level 3).

Analogue: the Mesozoic back-arc succession of the Main Cordillera at 33 to 36°S,
folded and thrust in the Aconcagua-type fold-and-thrust belt. An east-vergent
anticline-syncline pair with an overturned common limb, cut by a west-dipping
thrust that carries the anticline eastward over the syncline.

The folds are an inclined sine wave sheared toward the east. With a sheared
coordinate w = x - t * Z, where Z = z + y * tan(plunge), a bed at stratigraphic
height c is Z = c - A cos(k w): the axial surfaces are the planes w = const,
which dip west at atan(1 / t), and the east limb of each anticline is overturned
where t A k sin(k w) < -1.
"""

import math

import numpy as np

from geomapper_bake.authoring import element, fault, geomodel, pole_from_strike_dip, series

# Base of each unit, as stratigraphic height c; youngest first. The oldest unit is GemPy's basement.
BASES = {"calizas_titonianas": 260.0, "capas_rojas": 40.0, "yeso": -90.0}


def _shape(p):
    k = 2 * math.pi / p["wavelength_m"]
    return p["amplitude_m"], k, p["shear"], math.tan(math.radians(p["plunge"]))


def height(x, y, z, p):
    """Stratigraphic height of a point in the unfaulted folds."""
    a, k, t, tp = _shape(p)
    big_z = z + y * tp
    # Z - c = -A cos(k (x - t Z)) gives c directly once Z is known.
    return big_z + a * np.cos(k * (x - p["phase_m"] - t * big_z)) - p["reference_m"]


def height_gradient(x, y, z, p):
    a, k, t, tp = _shape(p)
    big_z = z + y * tp
    s = np.sin(k * (x - p["phase_m"] - t * big_z))
    gz = 1.0 + a * k * t * s
    return np.stack([-a * k * s, gz * tp, gz], axis=-1)


def thrust(p):
    pole = pole_from_strike_dip(p["thrust_strike"], p["thrust_dip"])  # dips west
    up_dip = np.array([-pole[0], -pole[1], 0.0]) * pole[2]
    up_dip[2] = math.hypot(pole[0], pole[1])
    up_dip /= np.linalg.norm(up_dip)
    through = np.array([p["thrust_x"], 0.0, p["thrust_z"]])
    return pole, up_dip, through


def in_hanging_wall(x, y, z, p):
    pole, _, through = thrust(p)
    return (x - through[0]) * pole[0] + (y - through[1]) * pole[1] + (z - through[2]) * pole[2] > 0


def bed_points(c, p, ys, ws):
    """Points on the folded base at height c, before faulting: (n, 3)."""
    a, k, t, tp = _shape(p)
    out = []
    for y in ys:
        big_z = p["reference_m"] + c - a * np.cos(k * ws)
        x = ws + p["phase_m"] + t * big_z
        out.append(np.column_stack([x, np.full_like(x, y), big_z - y * tp]))
    return np.vstack(out)


def faulted_points(points, p, extent):
    """Moves the hanging-wall part up the thrust; keeps what lands on the right side and inside the block."""
    _, up_dip, _ = thrust(p)
    d = p["thrust_slip_m"]
    foot = points[~in_hanging_wall(*points.T, p)]
    moved = points + d * up_dip
    hang = moved[in_hanging_wall(*moved.T, p)]
    xmin, xmax, ymin, ymax, zmin, zmax = extent
    both = np.vstack([foot, hang])
    keep = (both[:, 0] > xmin - 300) & (both[:, 0] < xmax + 300) & (both[:, 2] > zmin - 300) & (both[:, 2] < zmax + 300)
    return both[keep]


def build_model(ctx):
    p = ctx.params
    xmin, xmax, ymin, ymax, zmin, zmax = ctx.extent
    ys = np.linspace(ymin, ymax, 4)
    ws = np.linspace(-p["wavelength_m"] * 1.2, p["wavelength_m"] * 1.6, 40)
    _, up_dip, _ = thrust(p)
    beds = []
    for name, c in BASES.items():
        pts = faulted_points(bed_points(c, p, ys, ws), p, ctx.extent)
        # Orientations at every fourth point, from the unfaulted field at the restored position.
        sample = pts[::4]
        restored = np.where(in_hanging_wall(*sample.T, p)[:, None], sample - p["thrust_slip_m"] * up_dip, sample)
        g = height_gradient(*restored.T, p)
        g /= np.linalg.norm(g, axis=1, keepdims=True)
        beds.append(element(name, pts, np.column_stack([sample, g])))
    strata = series("mesozoico", beds)

    pole, _, through = thrust(p)
    cot = pole[2] / math.hypot(pole[0], pole[1])
    on_fault = [(through[0] + (z - through[2]) * cot * -np.sign(pole[0]), y, z) for z in (zmin, (zmin + zmax) / 2, zmax) for y in (ymin + 200, ymax - 200)]
    corrimiento = fault("corrimiento", element("corrimiento", on_fault, [(*through, *pole)]), offsets=[strata])
    return geomodel(ctx, [corrimiento, strata])


def fold_axes(ctx, ground):
    """Hinge traces at the ground, in model coordinates, for the answer key."""
    p = ctx.params
    a, k, t, tp = _shape(p)
    xmin, xmax, ymin, ymax, *_ = ctx.extent
    _, up_dip, _ = thrust(p)
    d = p["thrust_slip_m"]
    axes = []
    # Anticline crest where k w = pi, syncline trough where k w = 0 (and 2 pi).
    for kind, kw in (("anticline", math.pi), ("syncline", 0.0), ("syncline", 2 * math.pi), ("anticline", -math.pi)):
        trace = []
        for y in np.linspace(ymin, ymax, 17):
            x = p["phase_m"] + kw / k
            for _ in range(30):  # the hinge at the ground: x = w + t Z with Z from the ground there
                z = ground(x, y)
                hw = in_hanging_wall(x, y, z, p)
                x0, z0 = (x - d * up_dip[0], z - d * up_dip[2]) if hw else (x, z)
                x = kw / k + p["phase_m"] + t * (z0 + y * tp) + (x - x0)
            if xmin <= x <= xmax:
                trace.append((x, y))
        if len(trace) >= 2:
            # The axis plunges along the axial surface; its trend is along y here.
            axes.append({"type": kind, "trend": 0.0 if p["plunge"] > 0 else 180.0, "plunge": abs(p["plunge"]), "trace": trace})
    return axes
