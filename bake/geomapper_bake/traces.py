"""Vector traces of contacts and faults from rasters sampled on the terrain surface."""

from __future__ import annotations

from collections import defaultdict

import numpy as np

Node = tuple[int, int]


def boundary_labels(unit: np.ndarray, fault_side: np.ndarray, fault_active: np.ndarray):
    """Label every edge between neighbouring cells.

    unit: (h, w) unit index. fault_side, fault_active: (n_faults, h, w) booleans;
    a fault separates two cells when both lie in rocks it displaces and on
    opposite sides of it.

    Yields (label, a, b) with a and b the corner nodes (ix, iy) of the edge.
    A label is ("fault", index) or ("contact", low unit, high unit).
    """
    h, w = unit.shape
    for axis in (0, 1):  # 0: neighbours along y, 1: neighbours along x
        first = (slice(0, h - 1), slice(None)) if axis == 0 else (slice(None), slice(0, w - 1))
        second = (slice(1, h), slice(None)) if axis == 0 else (slice(None), slice(1, w))
        fault = np.full(unit[first].shape, -1)
        for k in range(len(fault_side) - 1, -1, -1):
            cut = (fault_side[k][first] != fault_side[k][second]) & fault_active[k][first] & fault_active[k][second]
            fault[cut] = k
        differs = unit[first] != unit[second]
        ys, xs = np.nonzero((fault >= 0) | differs)
        for y, x in zip(ys.tolist(), xs.tolist()):
            k = int(fault[y, x])
            if k >= 0:
                label: tuple = ("fault", k)
            else:
                u, v = int(unit[first][y, x]), int(unit[second][y, x])
                label = ("contact", min(u, v), max(u, v))
            if axis == 0:
                yield label, (x, y + 1), (x + 1, y + 1)
            else:
                yield label, (x + 1, y), (x + 1, y + 1)


def chain(segments: list[tuple[Node, Node]]) -> list[list[Node]]:
    """Join unit segments into polylines, breaking at branch points. Closed loops repeat their first node."""
    neighbours: dict[Node, list[Node]] = defaultdict(list)
    for a, b in segments:
        neighbours[a].append(b)
        neighbours[b].append(a)
    unused = {frozenset(s) for s in segments}

    def walk(start: Node, nxt: Node) -> list[Node]:
        line = [start, nxt]
        unused.discard(frozenset((start, nxt)))
        while len(neighbours[line[-1]]) == 2 and line[-1] != start:
            a, b = neighbours[line[-1]]
            step = b if a == line[-2] else a
            if frozenset((line[-1], step)) not in unused:
                break
            unused.discard(frozenset((line[-1], step)))
            line.append(step)
        return line

    lines = []
    for node in sorted(neighbours):
        if len(neighbours[node]) != 2:
            for nxt in sorted(neighbours[node]):
                if frozenset((node, nxt)) in unused:
                    lines.append(walk(node, nxt))
    for node in sorted(neighbours):  # what remains are closed loops
        for nxt in sorted(neighbours[node]):
            if frozenset((node, nxt)) in unused:
                lines.append(walk(node, nxt))
    return lines


def smooth(line: list[Node]) -> np.ndarray:
    """Replace a staircase by the midpoints of its steps, keeping the ends of open lines."""
    pts = np.asarray(line, dtype=float)
    mid = (pts[:-1] + pts[1:]) / 2.0
    if line[0] == line[-1]:
        return np.vstack([mid, mid[:1]])
    return np.vstack([pts[:1], mid, pts[-1:]])


def simplify(points: np.ndarray, tolerance: float) -> np.ndarray:
    """Douglas-Peucker."""
    if len(points) < 3:
        return points
    keep = np.zeros(len(points), dtype=bool)
    keep[[0, -1]] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        a, b = points[i], points[j]
        ab = b - a
        rel = points[i + 1 : j] - a
        length = np.hypot(*ab)
        if length == 0:
            dist = np.hypot(rel[:, 0], rel[:, 1])
        else:
            dist = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / length
        k = int(np.argmax(dist))
        if dist[k] > tolerance:
            keep[i + 1 + k] = True
            stack += [(i, i + 1 + k), (i + 1 + k, j)]
    return points[keep]


def trace(unit: np.ndarray, fault_side: np.ndarray, fault_active: np.ndarray, min_length: float = 0.0):
    """All traces as (label, points), points in raster cell units with the origin at the south-west corner.

    Lines shorter than min_length (in cells) are dropped.
    """
    by_label: dict[tuple, list[tuple[Node, Node]]] = defaultdict(list)
    for label, a, b in boundary_labels(unit, fault_side, fault_active):
        by_label[label].append((a, b))
    out = []
    for label in sorted(by_label):
        for line in chain(by_label[label]):
            pts = simplify(smooth(line), tolerance=0.75)
            length = float(np.hypot(*np.diff(pts, axis=0).T).sum())
            if length >= min_length and len(pts) >= 2:
                out.append((label, pts))
    return out
