"""Reads and checks scenario.yaml (see docs/scenario-authoring.md)."""

from __future__ import annotations

import copy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

from .scenario_format import load_schema

DEFAULT_RULES = {
    "field_days": 3,
    "minutes_per_day": 480,
    "sample_limit": 3,
    "scatter": {"strike_sigma_deg": 5.0, "dip_sigma_deg": 3.0, "poor_quality_factor": 2.0},
}


class ConfigError(Exception):
    pass


def _schema() -> dict[str, Any]:
    public = load_schema("units")["properties"]["units"]["items"]
    truth = load_schema("truth")["properties"]["units"]["items"]["properties"]
    unit = copy.deepcopy(public)
    unit["properties"].update({k: truth[k] for k in ("name", "age", "lab_age")})
    unit["properties"]["thickness_m"] = {"type": "number", "exclusiveMinimum": 0}
    unit["properties"]["features"] = {"type": "array", "items": {"type": "string", "minLength": 1}}
    unit["properties"]["way_up"] = {
        "type": "array",
        "items": load_schema("outcrops")["$defs"]["observation"]["properties"]["way_up"]["properties"]["indicator"],
    }
    unit["required"] = [*unit["required"], "name", "age"]
    name = {"type": "string", "minLength": 1}
    event = copy.deepcopy(load_schema("truth")["properties"]["events"]["items"])
    del event["properties"]["id"]
    event["properties"]["units"] = {"type": "array", "items": name}
    event["required"] = ["type", "rank", "label"]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["id", "title", "level", "grid", "series", "units", "events"],
        "properties": {
            "id": {"type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$"},
            "title": name,
            "level": {"type": "integer", "minimum": 0, "maximum": 6},
            "language": {"type": "string", "pattern": "^[a-z]{2}$"},
            "seed": {"type": "integer", "minimum": 0},
            "grid": {
                "type": "object",
                "additionalProperties": False,
                "required": ["nx", "ny", "nz", "cell_size_m", "origin"],
                "properties": {
                    "nx": {"type": "integer", "minimum": 2},
                    "ny": {"type": "integer", "minimum": 2},
                    "nz": {"type": "integer", "minimum": 1},
                    "cell_size_m": {"type": "number", "exclusiveMinimum": 0},
                    "cell_height_m": {"type": "number", "exclusiveMinimum": 0},
                    "origin": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["easting", "northing", "elevation"],
                        "properties": {k: {"type": "number"} for k in ("easting", "northing", "elevation")},
                    },
                },
            },
            "terrain": {
                "type": "object",
                "additionalProperties": False,
                "minProperties": 1,
                "maxProperties": 1,
                "properties": {
                    "file": name,
                    "procedural": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["base_m"],
                        "properties": {
                            k: {"type": "number"}
                            for k in (
                                "base_m", "relief_m", "slope_m_per_km", "slope_azimuth",
                                "noise_scale_m", "resistance_relief_m", "valley_depth_m", "valley_width_m",
                            )
                        },
                    },
                },
            },
            "exposure": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "target_fraction": {"type": "number", "exclusiveMinimum": 0, "maximum": 0.5},
                    "max_outcrop_cells": {"type": "integer", "minimum": 1, "maximum": 50},
                    "patch_scale_cells": {"type": "number", "exclusiveMinimum": 0},
                    "weights": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {k: {"type": "number", "minimum": 0} for k in ("slope", "ridge", "stream", "noise", "dyke")},
                    },
                },
            },
            "dykes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["unit", "through", "strike", "dip", "thickness_m", "length_m"],
                    "properties": {
                        "unit": name,
                        "through": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                        "strike": {"type": "number", "minimum": 0, "exclusiveMaximum": 360},
                        "dip": {"type": "number", "exclusiveMinimum": 0, "maximum": 90},
                        "thickness_m": {"type": "number", "exclusiveMinimum": 0},
                        "length_m": {"type": "number", "exclusiveMinimum": 0},
                    },
                },
            },
            "params": {"type": "object"},
            "variants": {
                "type": "object",
                "minProperties": 1,
                "propertyNames": {"pattern": "^[a-z0-9]+(-[a-z0-9]+)*$"},
                "additionalProperties": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"params": {"type": "object"}, "seed": {"type": "integer", "minimum": 0}},
                },
            },
            "rules": load_schema("manifest")["properties"]["rules"] | {"required": []},
            "bake": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "trace_refinement": {"type": "integer", "minimum": 1, "maximum": 8},
                    "mask_buffer_cells": {"type": "integer", "minimum": 0, "maximum": 8},
                },
            },
            "series": {
                "type": "object",
                "description": "Keyed by GemPy group name.",
                "additionalProperties": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["key"],
                    "properties": {
                        "key": {"type": "string", "pattern": "^s[0-9]{2}$"},
                        "kind": {"enum": ["sedimentary", "volcanic", "volcaniclastic", "metamorphic"]},
                        "intrusive": {"type": "boolean"},
                    },
                },
            },
            "faults": {
                "type": "object",
                "description": "Keyed by GemPy fault group name.",
                "additionalProperties": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["kinematics"],
                    "properties": {
                        "kinematics": {"enum": ["normal", "reverse", "thrust", "dextral", "sinistral", "oblique"]}
                    },
                },
            },
            "units": {"type": "object", "description": "Keyed by GemPy element name.", "additionalProperties": unit},
            "events": {"type": "array", "minItems": 1, "items": event},
            "lumpable": {"type": "array", "items": {"type": "array", "minItems": 2, "items": name}},
        },
    }


@dataclass
class ScenarioConfig:
    folder: Path
    raw: dict[str, Any]
    variant: str
    params: dict[str, Any]
    seed: int

    def __getitem__(self, key: str) -> Any:
        return self.raw[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.raw.get(key, default)

    @property
    def rules(self) -> dict[str, Any]:
        rules = copy.deepcopy(DEFAULT_RULES)
        given = self.raw.get("rules", {})
        rules["scatter"].update(given.get("scatter", {}))
        rules.update({k: v for k, v in given.items() if k != "scatter"})
        return rules


def load_config(folder: Path | str, variant: str | None = None) -> ScenarioConfig:
    folder = Path(folder)
    path = folder / "scenario.yaml"
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"cannot read {path}: {exc}") from exc

    errors = sorted(Draft202012Validator(_schema()).iter_errors(raw), key=lambda e: list(e.absolute_path))
    if errors:
        lines = [f"  {'/'.join(str(p) for p in e.absolute_path) or '(root)'}: {e.message}" for e in errors]
        raise ConfigError(f"{path} is not a valid scenario:\n" + "\n".join(lines))

    keys = [u["key"] for u in raw["units"].values()]
    if len(set(keys)) != len(keys):
        raise ConfigError(f"{path}: two units share a key")
    series_keys = [s["key"] for s in raw["series"].values()]
    if len(set(series_keys)) != len(series_keys):
        raise ConfigError(f"{path}: two series share a key")
    for name, s in raw["series"].items():
        if not s.get("intrusive") and "kind" not in s:
            raise ConfigError(f"{path}: series {name} needs a kind, or intrusive: true")
    names = set(raw["units"])
    used = {u for e in raw["events"] for u in e.get("units", [])} | {u for g in raw.get("lumpable", []) for u in g}
    used |= {k["unit"] for k in raw.get("dykes", [])}
    if used - names:
        raise ConfigError(f"{path}: events, lumpable or dykes refer to unknown units: {', '.join(sorted(used - names))}")

    variants = raw.get("variants") or {"a": {}}
    if variant is None:
        variant = next(iter(variants))
    if variant not in variants:
        raise ConfigError(f"{path}: no variant {variant!r}; choose from {', '.join(variants)}")
    chosen = variants[variant] or {}
    params = {**raw.get("params", {}), **chosen.get("params", {})}
    seed = chosen.get("seed", raw.get("seed", 0))
    return ScenarioConfig(folder=folder, raw=raw, variant=variant, params=params, seed=seed)
