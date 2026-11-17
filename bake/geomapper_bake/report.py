"""Validation report: one HTML page to check a baked scenario before students see it.

It shows the answer key, so it stays with the full bake output and is never published.
"""

from __future__ import annotations

import base64
import html
import io
import json
from typing import Any

import numpy as np

from .exposure import COVER_NAMES

COVER_COLOURS = ["#000000", "#b9a67c", "#e3dcc3", "#9a948a", "#6f8f55"]
COVER_LABELS = {"bare_rock": "roca", "soil": "suelo", "alluvium": "aluvio", "scree": "derrubios", "vegetation": "vegetación"}
TRACE_STYLE = {
    "depositional": ("#111111", "-", 1.2),
    "unconformity": ("#1f4fbf", "--", 1.4),
    "intrusive": ("#b01c8a", "-", 1.4),
    "fault": ("#d11919", "-", 2.2),
}
TRACE_LABELS = {"depositional": "contacto depositacional", "unconformity": "discordancia", "intrusive": "contacto intrusivo", "fault": "falla"}


def _png(fig) -> str:
    import matplotlib.pyplot as plt

    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=110, bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _hillshade(elevation: np.ndarray, cell: float) -> np.ndarray:
    gy, gx = np.gradient(elevation, cell)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    azimuth, altitude = np.radians(315.0), np.radians(45.0)
    return np.clip(np.sin(altitude) * np.cos(slope) + np.cos(altitude) * np.sin(slope) * np.cos(azimuth - aspect), 0, 1)


def _section_lines(result, ny: int, nx: int, cell: float) -> list[tuple[float, float, float, float]]:
    """Three lines across the area, perpendicular to the mean strike of bedding at the outcrops."""
    strikes = [p["strike"] for o in result.outcrops for p in o["observation"]["planes"] if p["kind"] == "bedding"]
    if strikes:
        doubled = np.radians(2 * np.array(strikes))
        strike = np.degrees(np.arctan2(np.sin(doubled).mean(), np.cos(doubled).mean())) / 2
    else:
        strike = 0.0
    across = np.radians(strike + 90.0)
    dx, dy = np.sin(across), np.cos(across)
    if dx < 0:
        dx, dy = -dx, -dy
    w, h = nx * cell, ny * cell
    lines = []
    for f in (0.25, 0.5, 0.75):
        cx, cy = (w / 2 - dy * (f - 0.5) * w, h / 2 + dx * (f - 0.5) * h)
        ts = []
        for lo, hi, c, v in ((0, w, cx, dx), (0, h, cy, dy)):
            if abs(v) > 1e-9:
                ts.append(sorted(((lo - c) / v, (hi - c) / v)))
        t0, t1 = max(t[0] for t in ts), min(t[1] for t in ts)
        lines.append((cx + t0 * dx, cy + t0 * dy, cx + t1 * dx, cy + t1 * dy))
    return lines


def _local(coords: list, origin: dict[str, float]) -> np.ndarray:
    return np.asarray(coords) - [origin["easting"], origin["northing"]]


def write_report(result) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch

    cfg = result.config
    manifest = json.loads((result.folder / "manifest.json").read_text(encoding="utf-8"))
    grid = manifest["grid"]
    nx, ny, nz = grid["nx"], grid["ny"], grid["nz"]
    d, dz = grid["cell_size_m"]["x"], grid["cell_size_m"]["z"]
    z0, origin = grid["origin"]["elevation"], grid["origin"]
    extent = [0, nx * d, 0, ny * d]
    units = [cfg["units"][n] for n in result.unit_names]
    colours = [u["colour"] for u in units]
    cmap = ListedColormap(colours)
    shade = _hillshade(result.elevation, d)
    xc, yc = (np.arange(nx) + 0.5) * d, (np.arange(ny) + 0.5) * d
    sections = _section_lines(result, ny, nx, d)
    contacts = result.truth["contacts"]["features"]
    dykes = result.truth.get("dykes", [])
    exposed = result.outcrop_labels > 0

    def base(ax, title):
        ax.set_title(title, fontsize=10)
        ax.set_aspect("equal")
        ax.set_xlim(0, nx * d)
        ax.set_ylim(0, ny * d)
        ax.set_xlabel("m al este del origen")
        ax.set_ylabel("m al norte del origen")

    def draw_traces(ax):
        for f in contacts:
            c = _local(f["geometry"]["coordinates"], origin)
            colour, style, width = TRACE_STYLE[f["properties"]["type"]]
            ax.plot(c[:, 0], c[:, 1], color=colour, ls=style, lw=width)
        for k in dykes:
            c = _local(k["trace"]["coordinates"], origin)
            ax.plot(c[:, 0], c[:, 1], color="#00d0ff", lw=2.0)

    # --- figure 1: true map -------------------------------------------------
    fig, ax = plt.subplots(figsize=(9.5, 9.5))
    ax.imshow(result.true_map, origin="lower", extent=extent, cmap=cmap, vmin=-0.5, vmax=len(units) - 0.5, interpolation="nearest")
    ax.imshow(shade, origin="lower", extent=extent, cmap="gray", alpha=0.28, vmin=0, vmax=1)
    levels = np.arange(np.floor(result.elevation.min() / 50) * 50, result.elevation.max() + 50, 50)
    cs = ax.contour(xc, yc, result.elevation, levels=levels, colors="k", linewidths=0.35, alpha=0.55)
    ax.clabel(cs, levels[::2], fontsize=6, fmt="%d")
    draw_traces(ax)
    bedding = [(o, p) for o in result.outcrops for p in o["observation"]["planes"] if p["kind"] == "bedding"]
    step = max(len(bedding) // 70, 1)
    length = 0.016 * nx * d
    for o, p in bedding[::step]:
        x, y = o["position"]["easting"] - origin["easting"], o["position"]["northing"] - origin["northing"]
        a, b = np.radians(p["strike"]), np.radians(p["strike"] + 90)
        ax.plot([x - length * np.sin(a), x + length * np.sin(a)], [y - length * np.cos(a), y + length * np.cos(a)], "k", lw=1.2)
        ax.plot([x, x + 0.5 * length * np.sin(b)], [y, y + 0.5 * length * np.cos(b)], "k", lw=1.2)
        ax.text(x + 1.1 * length * np.sin(b), y + 1.1 * length * np.cos(b), f"{p['dip']:.0f}", fontsize=6.5, ha="center", va="center")
    for i, (x1, y1, x2, y2) in enumerate(sections):
        ax.plot([x1, x2], [y1, y2], color="white", lw=1.3, ls=":")
        ax.text(x1, y1, f" {'ABC'[i]}", color="white", fontsize=11, fontweight="bold", va="bottom")
        ax.text(x2, y2, f"{'ABC'[i]}' ", color="white", fontsize=11, fontweight="bold", va="bottom", ha="right")
    used = sorted({f["properties"]["type"] for f in contacts})
    handles = [Patch(color=u["colour"], label=f"{u['key']}  {u['name']}") for u in units if u["rock_class"] != "hypabyssal" or not dykes]
    handles += [Line2D([], [], color=TRACE_STYLE[t][0], ls=TRACE_STYLE[t][1], lw=TRACE_STYLE[t][2], label=TRACE_LABELS[t]) for t in used]
    if dykes:
        handles.append(Line2D([], [], color="#00d0ff", lw=2, label="dique"))
    ax.legend(handles=handles, fontsize=7.5, loc="upper left", bbox_to_anchor=(1.01, 1.0), frameon=False)
    base(ax, "Mapa geológico verdadero (rumbo y manteo en una muestra de afloramientos)")
    fig_map = _png(fig)

    # --- figure 2: what the student can find ---------------------------------
    fig, ax = plt.subplots(figsize=(9.5, 9.5))
    ax.imshow(result.cover, origin="lower", extent=extent, cmap=ListedColormap(COVER_COLOURS), vmin=-0.5, vmax=4.5, interpolation="nearest")
    ax.imshow(shade, origin="lower", extent=extent, cmap="gray", alpha=0.3, vmin=0, vmax=1)
    rock = np.ma.masked_where(~exposed, result.true_map)
    ax.imshow(rock, origin="lower", extent=extent, cmap=cmap, vmin=-0.5, vmax=len(units) - 0.5, interpolation="nearest")
    key = set(result.truth["key_outcrops"])
    kx = [o["position"]["easting"] - origin["easting"] for o in result.outcrops if o["id"] in key]
    ky = [o["position"]["northing"] - origin["northing"] for o in result.outcrops if o["id"] in key]
    ax.scatter(kx, ky, s=38, facecolors="none", edgecolors="white", linewidths=1.2)
    handles = [Patch(color=COVER_COLOURS[i], label=COVER_LABELS[COVER_NAMES[i]]) for i in range(1, 5)]
    handles.append(Line2D([], [], marker="o", ls="", mfc="none", mec="k", label="afloramiento clave (contacto, falla o dique)"))
    ax.legend(handles=handles, fontsize=7.5, loc="upper left", bbox_to_anchor=(1.01, 1.0), frameon=False)
    base(ax, "Cobertura y afloramientos (roca coloreada por unidad)")
    fig_cover = _png(fig)

    # --- figure 3: sections ---------------------------------------------------
    fig, axes = plt.subplots(len(sections), 1, figsize=(11, 3.4 * len(sections)))
    zc = z0 + (np.arange(nz) + 0.5) * dz
    for i, (ax, (x1, y1, x2, y2)) in enumerate(zip(np.atleast_1d(axes), sections)):
        length_m = float(np.hypot(x2 - x1, y2 - y1))
        n = max(int(length_m / d), 2)
        t = (np.arange(n) + 0.5) / n
        ix = np.clip(((x1 + t * (x2 - x1)) / d).astype(int), 0, nx - 1)
        iy = np.clip(((y1 + t * (y2 - y1)) / d).astype(int), 0, ny - 1)
        ground = result.elevation[iy, ix]
        panel = np.ma.masked_where(zc[:, None] > ground[None, :] + dz / 2, result.litho[:, iy, ix])
        ax.imshow(panel, origin="lower", extent=[0, length_m, z0, z0 + nz * dz], cmap=cmap, vmin=-0.5, vmax=len(units) - 0.5, interpolation="nearest")
        ax.plot(t * length_m, ground, "k", lw=1.0)
        on_line = exposed[iy, ix]
        ax.plot((t * length_m)[on_line], ground[on_line] + 6, "v", color="k", ms=3.5)
        ax.set_ylim(z0, min(z0 + nz * dz, ground.max() + 120))
        ax.set_aspect("equal")
        ax.set_title(f"Sección {'ABC'[i]}–{'ABC'[i]}' (sin exageración vertical; triángulos: afloramientos)", fontsize=10)
        ax.set_ylabel("m s.n.m.")
    fig.tight_layout()
    fig_sections = _png(fig)

    # --- figure 4: stereonets, one per series ---------------------------------
    domains: dict[str, list[tuple[float, float]]] = {}
    series_of = {u["key"]: u.get("series", "sin serie") for u in result.truth["units"]}
    for o, p in bedding:
        domains.setdefault(series_of[o["observation"]["unit"]], []).append((p["strike"], p["dip"]))
    dyke_planes = [(p["strike"], p["dip"]) for o in result.outcrops for p in o["observation"]["planes"] if p["kind"] == "dyke"]
    if dyke_planes:
        domains["diques"] = dyke_planes

    def project(strike, dip):
        """Lower-hemisphere equal-area position of the pole to a plane."""
        trend = np.radians(np.asarray(strike) - 90.0)  # the pole plunges away from the dip direction
        plunge = np.radians(90.0 - np.asarray(dip))
        r = np.sqrt(2.0) * np.sin((np.pi / 2 - plunge) / 2)
        return r * np.sin(trend), r * np.cos(trend)

    fig, axes = plt.subplots(1, max(len(domains), 1), figsize=(4.2 * max(len(domains), 1), 4.4))
    for ax, (name, planes) in zip(np.atleast_1d(axes), domains.items()):
        circle = np.linspace(0, 2 * np.pi, 200)
        ax.plot(np.sin(circle), np.cos(circle), "k", lw=1)
        ax.plot([0], [0], "k+", ms=8)
        ax.text(0, 1.04, "N", ha="center", fontsize=9)
        s, dp = np.array(planes).T
        px, py = project(s, dp)
        ax.scatter(px, py, s=9, color="#b0553c" if name == "diques" else "#222222", alpha=0.6, linewidths=0)
        doubled = np.radians(2 * s)
        mean_strike = (np.degrees(np.arctan2(np.sin(doubled).mean(), np.cos(doubled).mean())) / 2) % 180
        ax.set_title(f"{name}: {len(planes)} polos\nrumbo medio {mean_strike:03.0f}/{(mean_strike + 180) % 360:03.0f}, manteo {dp.min():.0f}–{dp.max():.0f}°", fontsize=9)
        ax.set_aspect("equal")
        ax.axis("off")
    fig_stereo = _png(fig)

    # --- tables ---------------------------------------------------------------
    by_unit = {u["key"]: 0 for u in units}
    for o in result.outcrops:
        by_unit[o["observation"]["unit"]] += 1
    dyke_keys = {k["unit"] for k in dykes}
    with_dyke = sum(any(p["kind"] == "dyke" for p in o["observation"]["planes"]) for o in result.outcrops)
    rows = []
    for i, u in enumerate(units):
        on_map = result.true_map == i
        rows.append(
            f"<tr><td><span class='sw' style='background:{u['colour']}'></span>{u['key']}</td><td>{html.escape(u['name'])}</td>"
            f"<td>{html.escape(u['lithology'])}</td><td>{html.escape(u['age']['label'])}</td>"
            f"<td>{100 * on_map.mean():.1f}</td><td>{100 * (exposed & on_map).sum() / max(on_map.sum(), 1):.1f}</td><td>{by_unit[u['key']]}</td></tr>"
            if u["key"] not in dyke_keys
            else f"<tr><td><span class='sw' style='background:{u['colour']}'></span>{u['key']}</td><td>{html.escape(u['name'])}</td>"
            f"<td>{html.escape(u['lithology'])}</td><td>{html.escape(u['age']['label'])}</td>"
            f"<td colspan='2'>diques: líneas en el mapa</td><td>{with_dyke} lo muestran</td></tr>"
        )
    cover_rows = "".join(
        f"<tr><td>{COVER_LABELS[name]}</td><td>{100 * (result.cover == i).mean():.1f}</td></tr>" for i, name in enumerate(COVER_NAMES)
    )
    qualities = [o["observation"]["quality"] for o in result.outcrops]
    sizes = np.bincount(result.outcrop_labels[exposed])[1:] if exposed.any() else np.array([0])
    fraction = 100 * exposed.mean()
    verdict = "dentro" if 3.0 <= fraction <= 8.0 else "FUERA"
    key_by = {u["key"]: u["name"] for u in units}
    column = "".join(
        f"<tr><td>{html.escape(key_by[r['unit']])}</td><td>{r.get('thickness_m', '—')}</td><td>{r['base_contact']}</td></tr>"
        for r in reversed(result.truth["column"])
    )
    events = "".join(f"<li>{e['rank']}. {html.escape(e['label'])} <i>({e['type']})</i></li>" for e in result.truth["events"])
    stats: dict[str, Any] = {
        "Escenario": f"{manifest['scenario_id']} · variante {manifest['variant']} · semilla {manifest['seed']}",
        "Grilla": f"{nx} × {ny} × {nz} celdas de {d:g} m ({nx * d / 1000:g} × {ny * d / 1000:g} km, {z0:g} a {z0 + nz * dz:g} m s.n.m.)",
        "Relieve": f"{result.elevation.min():.0f} a {result.elevation.max():.0f} m s.n.m.",
        "Exposición": f"<b>{fraction:.1f} %</b> del área ({verdict} del rango 3–8 %)",
        "Afloramientos": f"{len(result.outcrops)} (tamaño mediano {np.median(sizes):.0f} celdas, máximo {sizes.max()}); "
        f"{qualities.count('good')} buenos, {qualities.count('fair')} regulares, {qualities.count('poor')} malos",
        "Afloramientos clave": f"{len(key)} con contacto, falla o dique",
        "Trazas": f"{len(contacts)} de contactos y fallas, {len(dykes)} de diques",
    }
    stat_rows = "".join(f"<tr><th>{k}</th><td>{v}</td></tr>" for k, v in stats.items())

    page = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe de validación: {html.escape(manifest['title'])}</title>
<style>
body{{font-family:system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:16px;color:#1c1c1c;background:#fafafa;line-height:1.45}}
h1{{font-size:1.5rem}} h2{{font-size:1.15rem;margin-top:2rem;border-bottom:1px solid #ccc;padding-bottom:4px}}
table{{border-collapse:collapse;font-size:.9rem;margin:.5rem 0}} th,td{{border:1px solid #d5d5d5;padding:4px 9px;text-align:left;vertical-align:top}}
th{{background:#efefef}} img{{max-width:100%;height:auto;background:#fff;border:1px solid #ddd}}
.sw{{display:inline-block;width:.9em;height:.9em;margin-right:.4em;border:1px solid #555;vertical-align:-1px}}
.note{{background:#fff6d6;border:1px solid #e6d28a;padding:8px 12px;font-size:.9rem}}
</style></head><body>
<h1>Informe de validación: {html.escape(manifest['title'])}</h1>
<p class="note">Este informe contiene la clave de respuestas. No debe publicarse ni entregarse a estudiantes.</p>
<table>{stat_rows}</table>
<h2>1. Mapa geológico verdadero</h2><img alt="Mapa geológico verdadero" src="data:image/png;base64,{fig_map}">
<h2>2. Secciones</h2><img alt="Tres secciones" src="data:image/png;base64,{fig_sections}">
<h2>3. Cobertura y afloramientos</h2><img alt="Cobertura y afloramientos" src="data:image/png;base64,{fig_cover}">
<table><tr><th>Cobertura</th><th>% del área</th></tr>{cover_rows}</table>
<h2>4. Unidades</h2>
<table><tr><th>Clave</th><th>Nombre</th><th>Litología</th><th>Edad</th><th>% del mapa</th><th>% expuesto de la unidad</th><th>Afloramientos</th></tr>{''.join(rows)}</table>
<h2>5. Redes estereográficas</h2>
<p>Polos de los planos medidos en los afloramientos, valores verdaderos sin dispersión. Proyección equiareal, hemisferio inferior.</p>
<img alt="Redes estereográficas" src="data:image/png;base64,{fig_stereo}">
<h2>6. Columna e historia</h2>
<table><tr><th>Unidad (techo arriba)</th><th>Espesor (m)</th><th>Contacto basal</th></tr>{column}</table>
<ol style="list-style:none;padding-left:0">{events}</ol>
</body></html>
"""
    (result.folder / "report.html").write_text(page, encoding="utf-8")
