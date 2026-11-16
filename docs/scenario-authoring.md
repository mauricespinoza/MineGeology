# Authoring a scenario

A scenario is a folder with two files, baked by one command:

```bash
geomapper bake scenarios/<name> --variant a --out build/<name>-a
```

Working examples: `bake/tests/scenarios/homocline` and `bake/tests/scenarios/faulted_cover`.

## model.py

A GemPy 3 script that defines two functions.

`build_model(ctx)` returns a GemPy `GeoModel`. `ctx.extent` is the block as `(xmin, xmax, ymin, ymax, zmin, zmax)`, `ctx.params` holds the parameters of the chosen variant and `ctx.seed` the seed. Model coordinates are metres east and north of the south-west corner of the area, and elevation in metres.

`build_terrain(x, y, ctx)` returns the elevation at arrays of x and y. It is optional: `terrain.file` in `scenario.yaml` can point to a `.npy` array of shape `(ny, nx)` instead, southern row first.

GemPy conventions that matter here:

- Groups are listed youngest first. A fault comes before the series it cuts.
- The surface points of an element lie on the **base** of that unit.
- GemPy adds a unit called `basement` below the last series. Describe it in `scenario.yaml` like any other unit.
- Orientation poles point toward younger beds. An overturned bed has a pole that points down.
- A fault displaces only the groups listed in its fault relations. Leave a sealing cover out of that list.

`geomapper_bake.authoring` has helpers (`element`, `series`, `fault`, `geomodel`, `pole_from_strike_dip`, `plane_points`) that remove the GemPy boilerplate. They are optional.

## scenario.yaml

```yaml
id: quebrada-los-litres        # lower case, hyphens
title: Quebrada Los Litres
level: 1                       # 1 to 6; 0 is for tests
language: es
seed: 7

grid:
  nx: 256
  ny: 256
  nz: 96
  cell_size_m: 10
  cell_height_m: 10            # optional, defaults to cell_size_m
  origin: {easting: 352000, northing: 5921000, elevation: 1000}   # fictional

params: {dip: 35}              # passed to model.py as ctx.params
variants:                      # optional; the first one is the default
  a: {}
  b: {params: {dip: 60}, seed: 8}

series:                        # one entry per GemPy series, by group name
  secuencia: {key: s01, kind: volcanic}       # sedimentary, volcanic, volcaniclastic or metamorphic
  pluton: {key: s02, intrusive: true}         # no bedding; its contacts are intrusive

faults:                        # one entry per GemPy fault group
  falla: {kinematics: reverse} # normal, reverse, thrust, dextral, sinistral or oblique

units:                         # one entry per GemPy element, by element name
  brechas:
    key: u02                   # opaque: must not follow the stratigraphic order
    name: Brechas El Maqui     # answer key only
    age: {label: Jurásico Superior, from_ma: 150, to_ma: 145}   # answer key only
    lab_age: {method: U-Pb, material: circón, value_ma: 148.0, error_ma: 1.2}   # optional
    thickness_m: 50            # optional, for the column
    rock_class: volcaniclastic
    lithology: brecha volcánica
    colour: "#8a6f4d"
    texture: breccia_coarse
    resistance: 0.6            # 0 to 1
    description:
      field: Brecha pardo rojiza, mal seleccionada, en bancos gruesos.
      hand_lens: Clastos angulosos de andesita en matriz de ceniza.
    fossils: []                # optional
    thin_section: ...          # optional

events:                        # the true history; equal ranks mean either order is accepted
  - {type: deposition, rank: 1, label: Depósito de brechas, units: [brechas]}
  - {type: tilting, rank: 2, label: Basculamiento}

lumpable: [[brechas, lavas]]   # optional: units a student may map as one

rules:                         # optional; these are the defaults
  field_days: 3
  minutes_per_day: 480
  sample_limit: 3

bake:                          # optional
  trace_refinement: 4          # contact traces are cut at cell_size_m / 4
  mask_buffer_cells: 0         # hide bedding within this many cells of a fault or series boundary
```

Text with a comma or a colon must be on its own line (as `field:` above) or in quotes, or YAML will split it.

The bake stops with a message if `model.py` and `scenario.yaml` name different units, series or faults, if the terrain leaves the block, or if the result is not a valid scenario.

## What the bake derives

- **Contact types.** Two units of the same series: depositional. Different series: an unconformity, or an intrusive contact if the younger series is marked `intrusive`. A boundary between rocks on opposite sides of a fault that displaces both: a fault, with the kinematics from `faults`.
- **The column.** Units of bedded series, oldest first, from the GemPy order.
- **Unit order in the files.** Sorted by key, so the order tells the student nothing.
