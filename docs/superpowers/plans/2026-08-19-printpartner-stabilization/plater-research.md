# Rhoban Plater research

Research snapshot: 2026-08-19, repository head [`6c4f924504979095b1b45cf8fd81b1e38f0f8642`](https://github.com/Rhoban/Plater/commit/6c4f924504979095b1b45cf8fd81b1e38f0f8642), verified against `refs/heads/master`.

## Recommendation

Plater's arranging behavior is a useful reference for PrintPartner. It packs
rasterized footprints with spacing and creates another plate when a part does
not fit. Plater also tests yaw rotations around Z, but PrintPartner will not
copy that behavior. PrintPartner preserves the exact source orientation and
leaves rotation to the slicer. [`README.md`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/README.md#L9-L20) [`Part.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Part.cpp#L25-L60) [`PlacedPart.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/PlacedPart.cpp#L14-L19)

It is not a drop-in production dependency. Its plate export is a merged STL, so it loses the named-object structure PrintPartner needs for printer API tracking. The repository license is CC BY-NC 3.0, which prohibits exercising the licensed rights for a use primarily intended for commercial advantage. Shipping, modifying, or hosting this code needs compliance with Rhoban's separate license and attribution terms. [`Plate.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Plate.cpp#L32-L41) [`Request.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Request.cpp#L195-L201) [`LICENSE`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/LICENSE) [CC BY-NC 3.0, sections 3 and 4](https://creativecommons.org/licenses/by-nc/3.0/legalcode#section-4)

The product decision after this research is to use no Plater package, binary,
source code, service, or exporter. PrintPartner will implement its own
Arrangement engine from a behavior specification and its own fixtures. The
implementation may use general ideas such as projected footprints, spacing,
position search, and overflow Plates without porting Plater code.

This removes Plater's output and license from the implementation path. The
facts remain documented because they explain why Plater was rejected as a
dependency.

## What Plater actually does

### Mesh loading and orientation

The CLI accepts STL files. Its loader handles ASCII and binary STL, converts coordinates from millimeters to an internal scale of 1,000 units per millimeter, and ignores the supplied facet normals when it builds its triangle model. There is also an internal binary mesh stream path, but the CLI does not expose it. It has no OBJ or 3MF importer. [`StlFactory.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/stl/StlFactory.cpp#L72-L116) [`StlFactory.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/stl/StlFactory.cpp#L161-L220) [`StlFactory.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/stl/StlFactory.cpp#L222-L294)

Each input line contains a filename, quantity, and optional face. The default face is `bottom`. In code, `bottom` returns the mesh unchanged. The other choices apply fixed X or Y rotations for `front`, `top`, `back`, `left`, or `right`. Plater then centers the XY bounds and moves the lowest Z point to Z=0. [`README.md`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/README.md#L79-L96) [`Request.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Request.cpp#L137-L165) [`Model.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/stl/Model.cpp#L201-L221)

During nesting, Plater rotates the footprint and final mesh only around Z. The angle interval is global, with a 90 degree default. A 360 degree interval yields one tested yaw and therefore locks the source orientation, but Plater cannot lock one part while allowing another part to rotate. [`Request.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Request.cpp#L26-L39) [`Part.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Part.cpp#L28-L60) [`Placer.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Placer.cpp#L94-L129)

That distinction matters. Z rotation keeps the same face on the bed and does
not change the model's direction relative to the layer stack. It can still
change a deliberately chosen yaw, seam direction, or printer-axis alignment.
PrintPartner therefore preserves the exact source orientation and offers no
rotation policy or rotation control. The user makes any rotation in the slicer.

### Footprints, spacing, and bounds

Plater projects every mesh triangle onto XY, tests raster sample points against the projected triangles, and builds a bitmap at the configured precision. This is the full top-view shadow of the part, not only its first-layer contact area. A quadtree narrows the triangle tests. [`Model.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/stl/Model.cpp#L47-L116) [`QuadTree.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/QuadTree.cpp#L26-L91)

It expands each rasterized footprint by the configured spacing before collision checks. Because both neighboring footprints carry this padding, the physical gap can approach twice the entered spacing, with raster rounding on top. PrintPartner should calibrate this with fixtures before presenting the value as literal millimeters between parts. [`Model.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/stl/Model.cpp#L90-L116) [`Bitmap.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Bitmap.cpp#L158-L178)

The plate is a bitmap. Rectangular plates enforce width and height. Circular plates mark pixels outside the radius as occupied. The current model has no polygonal bed shape, exclusion zones, purge area, clips, or toolhead-clearance rules. [`Plate.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Plate.cpp#L9-L29) [`Plate.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Plate.cpp#L54-L74)

Plater checks only the XY footprint against the plate. It does not compare model height with printer Z capacity. PrintPartner must reject an over-height part before arranging it. [`Part.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Part.cpp#L38-L67)

### Placement, duplicates, and multiple plates

For each part, the placer tests every allowed Z rotation and walks candidate X and Y positions on a configurable grid. It keeps the valid position with the lowest gravity-style score, which pulls parts toward one corner. It tries several part orders, rotation traversal orders, and gravity directions, then keeps the solution with the fewest plates. Optional shuffled orders introduce nondeterminism, so PrintPartner must store accepted placements instead of expecting a rerun to reproduce them. [`Placer.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Placer.cpp#L26-L129) [`Request.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Request.cpp#L293-L376) [`Solution.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Solution.cpp#L31-L45)

Quantity creates repeated placed instances of the same `Part`, and an unplaced instance causes Plater to add another plate. There is no maximum plate count. Repeated instances retain only the source filename as their name, so they do not have stable unit IDs. [`Placer.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Placer.cpp#L13-L22) [`Placer.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Placer.cpp#L139-L164) [`PlacedPart.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/PlacedPart.cpp#L31-L37)

### Output

Plater writes one binary STL or diagnostic PPM per plate. The optional `plates.csv` contains the plate number, source filename, center X, center Y, and Z rotation. It has no 3MF writer. [`main.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/main.cpp#L17-L40) [`Request.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Request.cpp#L222-L282)

The STL output merges all placed meshes into one model and recenters the completed plate. That output is unsuitable for PrintPartner because object names and per-unit identity disappear. The CSV is the useful output, but its filename key is ambiguous for duplicates and it does not report the centering transform applied to the merged plate STL. [`Plate.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Plate.cpp#L32-L41) [`PlacedPart.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/PlacedPart.cpp#L14-L29) [`Request.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Request.cpp#L222-L240)

Open pull request [#38](https://github.com/Rhoban/Plater/pull/38) adds an unmerged multi-plate 3MF writer, faster bitmap collision, more placement algorithms, and a consolidation pass. It is useful prior art, not released behavior. The 3MF identifies itself as OrcaSlicer 2.3.0, writes BambuStudio metadata, fixes printable height at 250 mm, assigns every object to extruder 1, and names repeated objects with the same source filename. That contract is too slicer-specific and does not preserve PrintPartner's required-unit IDs. The pull request is open, has no reviewer, and is not part of `master`. [PR #38 source](https://github.com/weasel0x00/Plater/blob/feat/output-and-algorithms/plater/ThreeMF.cpp) [PR #38 status](https://github.com/Rhoban/Plater/pull/38)

## Performance and project health

The repository publishes no benchmark or automated test suite at the current head. Its CMake files build a C++11 static library and CLI, with threading as the only core dependency. [`repository tree`](https://github.com/Rhoban/Plater/tree/6c4f924504979095b1b45cf8fd81b1e38f0f8642) [`plater/CMakeLists.txt`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/CMakeLists.txt#L25-L70)

Runtime grows sharply as quality settings tighten. Finer footprint precision increases bitmap memory and collision work in two dimensions. A smaller position step increases candidate positions in two dimensions. A smaller rotation step adds more footprint variants. Multiple-sort mode runs more complete placers, while the thread count controls how many run at once. [`Model.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/stl/Model.cpp#L90-L116) [`Placer.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Placer.cpp#L94-L124) [`Request.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Request.cpp#L305-L369)

The repository is lightly maintained. The latest commit on `master` is from March 24, 2025 and adjusts Qt linkage. The only published tag is `v1.0.0` from December 4, 2019. Two unreviewed pull requests were opened in June 2026, but neither is merged. [`commit history`](https://github.com/Rhoban/Plater/commits/master/) [`tags`](https://github.com/Rhoban/Plater/tags) [`pull requests`](https://github.com/Rhoban/Plater/pulls) [`latest commit`](https://github.com/Rhoban/Plater/commit/6c4f924504979095b1b45cf8fd81b1e38f0f8642)

There is one concrete CLI integration hazard in the current source. `Request::sortMode` is declared but not initialized by the constructor, and the CLI assigns it only when `-S` is present. A wrapper must set it explicitly or always pass `-S`. Open pull request [#39](https://github.com/Rhoban/Plater/pull/39) contains the one-line fix, but it is not merged. This, plus the lack of tests, means we should treat upstream as algorithm source code that needs a hardened adapter rather than a trusted executable contract. [`Request.h`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Request.h#L44-L57) [`Request.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Request.cpp#L23-L40) [`main.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/main.cpp#L42-L96)

## Rejected Plater integration choices

### Native CLI adapter

A pinned native CLI could return placement CSV to the Node server. This was
investigated and rejected because it would add a third-party executable and a
second deployment contract. [`README.md`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/README.md#L50-L76) [`main.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/main.cpp#L98-L111) [`Request.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Request.cpp#L222-L240)

This adapter also needs to reproduce Plater's transform order. Plater first applies the selected face, centers the part's XY bounds, lowers its minimum Z to zero, rotates around Z, and translates to the reported center. Using the CSV numbers as raw translation on the untouched STL would place some parts incorrectly. [`Model.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/stl/Model.cpp#L144-L221) [`PlacedPart.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/PlacedPart.cpp#L14-L29)

A Plater adapter would need a Z-rotation transform that PrintPartner does not
currently store. That mismatch is another reason not to build the adapter. The
accepted native engine needs persistent X and Y positions only. It must apply
the same positions to preview, bounds, collision checks, persistence, and 3MF
export. [`plate-packer.ts`](../../../../web/packages/domain/src/plate-packer.ts#L72-L88) [`stl-mesh.ts`](../../../../web/packages/domain/src/stl-mesh.ts#L97-L119) [`export-3mf.ts`](../../../../web/packages/domain/src/export-3mf.ts#L103-L142)

### Other boundaries

- A Node native addon around `libplater` would avoid subprocess parsing, but it couples the server to C++ memory ownership, build tooling, and upstream internals. The repository exports a static library, not a stable C ABI. [`plater/CMakeLists.txt`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/CMakeLists.txt#L25-L70) [`Request.h`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Request.h)
- A separate local or Docker service gives good isolation, but it does not solve the noncommercial license restriction. It also adds deployment work without improving the placement contract.
- WebAssembly is possible as a port, not as an existing integration. The repository has no Emscripten target or JavaScript bindings. Its current entry points use native files, process arguments, and `std::thread`. [`repository tree`](https://github.com/Rhoban/Plater/tree/6c4f924504979095b1b45cf8fd81b1e38f0f8642) [`main.cpp`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/main.cpp) [`Placer.h`](https://github.com/Rhoban/Plater/blob/6c4f924504979095b1b45cf8fd81b1e38f0f8642/plater/Placer.h#L1-L49)

## Product contract to keep regardless of engine

The arranger should accept stable required-unit IDs, original meshes, an
assigned printer's X, Y, and Z limits, and spacing. It should return plates
containing unit IDs and X and Y positions. PrintPartner, not the arranger,
should remain responsible for the named-object 3MF.

Use millimeters throughout. The input mesh retains its authored coordinates
and orientation. Compute its axis-aligned bounds without recentering or
rotating it. Plate coordinates use +X to the right, +Y away from the front,
and +Z upward, with `(0, 0)` at the lower-left of the printer's printable XY
planning bounds. Non-rectangular beds and exclusion zones use that same frame.

STL coordinates are unitless, so PrintPartner's arranged path interprets them
as millimeters and applies `scaleToMm = 1`. It does not guess inches from model
size or silently rescale a mesh. Persist that scale with the Plate revision and
show the measured dimensions before arrangement. A user with differently
authored units must correct the source in the slicer or modeling tool and use
Direct export until a reviewed scaling workflow exists. A fixture with
inch-intended and millimeter-intended labels but identical STL coordinates must
produce the same millimeter geometry, proving there is no hidden conversion.

A returned `(x, y)` is the world position of the mesh's minimum X and minimum
Y bounds. Preview and export apply translation `(x - minX, y - minY, -minZ)`;
the last component places the authored bottom at Z=0 without changing its
orientation. Height is `maxZ - minZ`. Collision checks, bounds validation,
persistence, preview, and named-object 3MF export must all consume this exact
transform contract. A fixture with a negative, off-center mesh origin must
produce identical bounds and positions in every consumer.

This keeps the workflow the user described:

1. Select units manually or by repository, directory, naming rule, or another group.
2. Assign the units to one or more printers.
3. Validate each unit against the chosen printer's X, Y, and Z limits.
4. Preserve the exact source orientation. Do not rotate the unit.
5. Arrange into as many plates as needed.
6. Let the user review and adjust the result. Validate every manual move for
   collision and XY bounds before saving; persist only a valid placement
   revision. Reject overlapping and out-of-bed edits in domain and editor
   tests.
7. Export named-object 3MF files, or bypass arranging and export the original STLs.

That contract lets PrintPartner change arranging engines later without changing Builds, Plates, required units, checkoff, exports, or printer tracking.
