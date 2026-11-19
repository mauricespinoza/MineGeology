# Authoring a scenario

A scenario is a folder with two files, baked by one command:

```bash
geomapper bake scenarios/<name> --variant a --out build/<name>-a --report
```

`--report` also writes `report.html`, the validation report: true map, three sections, cover and outcrops, stereonets and exposure statistics. `--coarsen 4` bakes a quick draft with cells four times larger; use it while shaping a scenario and bake at full resolution at the end.

Working examples: `scenarios/quebrada-los-litres`, and the smaller `bake/tests/scenarios/homocline` and `bake/tests/scenarios/faulted_cover`.

## model.py

A GemPy 3 script that defines two functions.

`build_model(ctx)` returns a GemPy `GeoModel`. `ctx.extent` is the block as `(xmin, xmax, ymin, ymax, zmin, zmax)`, `ctx.params` holds the parameters of the chosen variant and `ctx.seed` the seed. Model coordinates are metres east and north of the south-west corner of the area, and elevation in metres.

Terrain comes from one of three places: `terrain.procedural` in `scenario.yaml` (relief generated from the model, so resistant units stand high and streams cut valleys), `terrain.file` (a `.npy` array of shape `(ny, nx)`, southern row first), or a function `build_terrain(x, y, ctx)` in `model.py` that returns the elevation at arrays of x and y.

GemPy conventions that matter here:

- Groups are listed youngest first. A fault comes before the series it cuts.
- The surface points of an element lie on the **base** of that unit.
- GemPy adds a unit called `basement` below the last series. Describe it in `scenario.yaml` like any other unit.
- Orientation poles point toward younger beds. An overturned bed has a pole that points down.
- A fault displaces only the groups listed in its fault relations. Leave a sealing cover out of that list.

`build_model` may also be replaced by `build_analytic(ctx)`, which returns a `geomapper_bake.authoring.AnalyticModel`: the geology written as formulas, for structures GemPy cannot express (scenario 4, `scenarios/estero-las-tobas`, is one: GemPy smoothed its growth wedge away). It lists the same groups and elements as a GemPy model would and gives, for each point, the rock and the scalar field of each group (the signed distance to a fault plane; for a series, a value that grows toward younger beds). It bakes in seconds.

`fold_axes(ctx, ground)` in `model.py` is optional: it returns the folds of the answer key as `{type: anticline | syncline | monocline, trend, plunge, trace: [(x, y), ...]}` in model coordinates. `ground(x, y)` gives the baked terrain elevation, to place axial traces at the surface. The grader compares the fold axis the student gets from the stereonet with these.

`geomapper_bake.authoring` has helpers (`element`, `series`, `fault`, `geomodel`, `pole_from_strike_dip`, `plane_points`) that remove the GemPy boilerplate. They are optional.

## scenario.yaml

```yaml
id: quebrada-los-litres        # lower case, hyphens
title: Quebrada Los Litres
summary: Una línea para la pantalla de inicio, sin dar la respuesta.   # optional
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
  falla:
    kinematics: reverse        # normal, reverse, thrust, dextral, sinistral or oblique
    indicators: [steps, riedel]   # optional: shear-sense indicators its outcrops may show;
                               # default steps, riedel, tension_gashes, drag; for mylonites use sc_fabric, sigma_clast
    relief: {scarp_m: 20, trough_m: 8}   # optional: how the fault shows in the land (metres; 0 turns one off).
                               # Also scarp_width_m (18), scarp_decay_m (220), trough_width_m (16), zone_width_m (25).
                               # bake: {fault_relief: false} turns scarps and troughs off for the whole scenario.

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
    features:                  # optional: what an outcrop of this unit may show; one or two are picked
      - Gradación normal en un banco de brecha
    way_up: [graded_bedding]   # optional: way-up indicators this unit can show

events:                        # the true history; equal ranks mean either order is accepted
  - {type: deposition, rank: 1, label: Depósito de brechas, units: [brechas]}
  - {type: tilting, rank: 2, label: Basculamiento}

lumpable: [[brechas, lavas]]   # optional: units a student may map as one

terrain:                       # optional if model.py defines build_terrain
  procedural:
    base_m: 760                # mean elevation
    slope_m_per_km: 90         # regional slope ...
    slope_azimuth: 250         # ... descending toward this azimuth
    relief_m: 200              # random relief
    noise_scale_m: 520         # size of hills
    resistance_relief_m: 110   # height difference between the most and least resistant rock
    valley_depth_m: 130        # depth of the main valleys
    valley_width_m: 60

exposure:                      # optional
  target_fraction: 0.05        # share of the area that is bare rock
  max_outcrop_cells: 6         # outcrops are cut to this many cells a side
  weights: {slope: 0.35, ridge: 0.25, stream: 0.30, noise: 0.45, dyke: 0.10}

dykes:                         # optional: planar sheets added after GemPy
  - unit: diques               # a unit described under units, not a GemPy element
    through: [760, 1900, 760]  # a point on the dyke: x, y in model coordinates, elevation
    strike: 302
    dip: 86
    thickness_m: 6
    length_m: 1500

aureoles:                      # optional: contact aureoles added after GemPy
  - unit: corneanas            # a unit described under units, not a GemPy element
    around: granodiorita       # the intrusive unit
    hosts: [pizarras, basement]   # units that turn into the aureole rock
    width_m: 160               # true distance from the intrusion, in 3D

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

- **Contact types.** An aureole against its host: gradational. Two units of the same series: depositional. Different series: an unconformity, or an intrusive contact if the younger series is marked `intrusive`. A boundary between rocks on opposite sides of a fault that displaces both: a fault, with the kinematics from `faults`.
- **The column.** Units of bedded series, oldest first, from the GemPy order.
- **Faults in the land.** Where a fault offsets the rock at the surface, a procedural terrain gets a scarp on the upthrown block (the hanging wall of a reverse fault or thrust, the footwall of a normal fault; none for strike-slip) and a trough of crushed rock along the trace, settled before streams cut their valleys so that they can follow it. The cover gets a strip of fault breccia (`fault_zone`) along the trace, with only a few outcrops left across it. Under beds that seal the fault there is nothing. See `bake/geomapper_bake/faultzone.py`.
- **Terrain, cover and outcrops.** Seeded by `seed`, so the same scenario always gives the same ground. A variant with another seed gives the same geology under different outcrops.
- **What an outcrop shows.** Its unit, the true bedding at that spot, one or two of the unit's `features`, a way-up indicator on the better outcrops, and any contact, fault or dyke that crosses it, with the evidence a student would see. Fault striae follow the stated kinematics, and every exposed fault shows a shear-sense indicator on at least one outcrop (more on good outcrops). A metamorphic series gives foliation instead of bedding.
- **Unit order in the files.** Sorted by key, so the order tells the student nothing.
