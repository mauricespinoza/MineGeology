"""Evaluates a GemPy model at arbitrary points. The only module that imports GemPy."""

from __future__ import annotations

import contextlib
import io
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Group:
    """A GemPy structural group: a series of units, or a fault."""

    name: str
    is_fault: bool
    elements: tuple[str, ...]
    offsets: tuple[int, ...]  # for a fault: indices of the groups it displaces


@dataclass
class Evaluation:
    """Model values at a set of points.

    element: index into ModelRunner.elements for each point.
    scalar, gradient: one array per group, in group order. The gradient of a
    series points toward younger rocks; it is normal to bedding.
    threshold: for a fault group, the scalar value of the fault surface.
    """

    element: np.ndarray
    scalar: list[np.ndarray]
    gradient: list[np.ndarray]
    threshold: list[np.ndarray]


class ModelRunner:
    def __init__(self, geo_model) -> None:
        self.geo = geo_model
        frame = geo_model.structural_frame
        relations = np.asarray(frame.fault_relations, dtype=bool)
        groups = []
        for i, g in enumerate(frame.structural_groups):
            groups.append(
                Group(
                    name=g.name,
                    is_fault=bool(g.is_fault),
                    elements=tuple(e.name for e in g.elements),
                    offsets=tuple(int(j) for j in np.flatnonzero(relations[i])) if g.is_fault else (),
                )
            )
        self.groups: list[Group] = groups

        # GemPy numbers every element from 1 in this order, faults included, and
        # adds a basement below the last series.
        self._gempy_names = list(frame.elements_names)
        fault_elements = {e for g in groups if g.is_fault for e in g.elements}
        self.elements: list[str] = [n for n in self._gempy_names if n not in fault_elements]
        last_series = max(i for i, g in enumerate(groups) if not g.is_fault)
        self.element_group: dict[str, int] = {e: i for i, g in enumerate(groups) for e in g.elements}
        for name in self.elements:
            self.element_group.setdefault(name, last_series)

        options = geo_model.interpolation_options.evaluation_options
        options.compute_scalar_gradient = True
        options.mesh_extraction = False

    def evaluate(self, xyz: np.ndarray) -> Evaluation:
        """xyz: (n, 3) array of east, north, elevation in model coordinates."""
        import gempy as gp

        xyz = np.ascontiguousarray(xyz, dtype=float)
        with contextlib.redirect_stdout(io.StringIO()):
            gp.set_custom_grid(self.geo.grid, xyz)
            solution = gp.compute_model(self.geo)

        ids = np.rint(np.asarray(solution.raw_arrays.custom)).astype(int) - 1
        if ids.shape != (len(xyz),):
            raise RuntimeError(f"GemPy returned {ids.shape} values for {len(xyz)} points")
        lookup = np.array([self.elements.index(n) if n in self.elements else -1 for n in self._gempy_names])
        element = lookup[ids]
        if (element < 0).any():
            raise RuntimeError("GemPy assigned a fault id to a rock cell")

        outputs = None
        for level in solution.octrees_output:
            window = level.outputs[0].grid.custom_grid_slice
            if window.stop - window.start == len(xyz):
                outputs = level.outputs
                break
        if outputs is None or len(outputs) != len(self.groups):
            raise RuntimeError("could not find GemPy's scalar fields for the requested points")

        scalar, gradient, threshold = [], [], []
        for out in outputs:
            window = out.grid.custom_grid_slice
            fields = out.scalar_fields.exported_fields
            scalar.append(np.asarray(fields.scalar_field)[window])
            gradient.append(
                np.stack([np.asarray(f)[window] for f in (fields.gx_field, fields.gy_field, fields.gz_field)], axis=1)
            )
            threshold.append(np.atleast_1d(np.asarray(fields.scalar_field_at_surface_points, dtype=float)))
        return Evaluation(element=element, scalar=scalar, gradient=gradient, threshold=threshold)
