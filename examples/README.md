# Test examples

All native and future web conformance inputs live here and are included in the outer repository. Tests never read examples from `references/`. Keep input files, imports and local assets together; generated SVGs and screenshots belong in `artifacts/`.

- `cases.json` selects the four fast runs: chess, imports, all boards and a nested board.
- `files/` contains all 79 upstream file examples and their local `icon.svg` asset. Names are flattened; the table below records original paths. No input bytes were changed.
- `archives/txtar/` and `archives/asciitxtar/` contain 50 and 14 extracted archive entries as ordinary D2 files, named after the original entry. Archive separators are removed; D2 contents are preserved.
- `imports/` and `boards/` contain multi-file cases adapted from upstream Go tests. They are input workspaces, not independent cases for each helper file.
- `research/identity/` contains locally authored research cases for imports/classes/globs, board-local identity, invisible labels and a proposed quoted-ID collision. They are separate from the 147-run upstream corpus and are executed by `mise run test:research:identity` and the native-operation probe. A collision input is an experiment, not a claim that the collision occurs.
- `research/text/` contains the locally authored repeated Latin label used by `mise run test:research:text` to compare native scene glyph/font data and browser font metrics. It is not part of the upstream corpus and does not establish text parity.
- `research/sizing/main.d2` is the geometry input with explicit source dimensions 160×80, used for the native relayout/image comparison. It is separate from the 147-run corpus.

`mise run test:native` runs the fast set. `mise run test:native:corpus` adds the 79 files and 64 archive entries: 147 runs total. The root example-inventory test checks registration, input location and supporting files without requiring an upstream checkout.

## Provenance

Copied from D2 v0.9.0, commit [d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda](https://github.com/d2lang/d2/tree/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda), under [MPL-2.0](LICENSE.txt). `files/icon.svg` comes from `e2etests-cli/testdata/raster/icon.svg`. Archive entries come from `e2etests/txtar.txt` and `e2etests/asciitxtar.txt`.

`imports/` and `boards/` copy `TestCLI_E2E/import` and `TestCLI_E2E/board_import` in [e2etests-cli/main_test.go](https://github.com/d2lang/d2/blob/d5a51743b6d5c00f1ec6f8340003f5d5a6ba4eda/e2etests-cli/main_test.go). The entry file is named `main.d2` instead of `hello-world.d2`; contents and supporting files are unchanged apart from final newlines.

Remote image URLs remain as upstream wrote them. This makes the inputs independent of `references/`, but remote assets still require network access. The Twitter and WCC cases have known broken URLs; failures must remain visible. These examples do not cover every Go-defined upstream case or certify React parity.

| Local file in `files/` | Original path in D2 |
| --- | --- |
| `chess.d2` | `docs/examples/chess/dia.d2` |
| `flipt.d2` | `docs/examples/flipt/input.d2` |
| `japan.d2` | `docs/examples/japan-grid/japan.d2` |
| `twitter.d2` | `docs/examples/twitter/in.d2` |
| `vector-grid.d2` | `docs/examples/vector-grid/vector-grid.d2` |
| `wcc.d2` | `docs/examples/wcc/wcc.d2` |
| `flow.d2` | `docs/flow.d2` |
| `all_shapes_link.d2` | `e2etests/testdata/files/all_shapes_link.d2` |
| `arrowhead_font_color.d2` | `e2etests/testdata/files/arrowhead_font_color.d2` |
| `arrowhead_scaling.d2` | `e2etests/testdata/files/arrowhead_scaling.d2` |
| `centered_horizontal_connections.d2` | `e2etests/testdata/files/centered_horizontal_connections.d2` |
| `cloud_shaped_grid.d2` | `e2etests/testdata/files/cloud_shaped_grid.d2` |
| `code_font_size.d2` | `e2etests/testdata/files/code_font_size.d2` |
| `cross_arrowhead.d2` | `e2etests/testdata/files/cross_arrowhead.d2` |
| `cylinder_grid_label.d2` | `e2etests/testdata/files/cylinder_grid_label.d2` |
| `dagger_grid.d2` | `e2etests/testdata/files/dagger_grid.d2` |
| `dagre_disconnected_edge.d2` | `e2etests/testdata/files/dagre_disconnected_edge.d2` |
| `dagre_spacing.d2` | `e2etests/testdata/files/dagre_spacing.d2` |
| `dagre_spacing_right.d2` | `e2etests/testdata/files/dagre_spacing_right.d2` |
| `disclaimer.d2` | `e2etests/testdata/files/disclaimer.d2` |
| `disconnect_direction_right.d2` | `e2etests/testdata/files/disconnect_direction_right.d2` |
| `empty_nested_grid.d2` | `e2etests/testdata/files/empty_nested_grid.d2` |
| `ent2d2_basic.d2` | `e2etests/testdata/files/ent2d2_basic.d2` |
| `ent2d2_right.d2` | `e2etests/testdata/files/ent2d2_right.d2` |
| `executive_grid.d2` | `e2etests/testdata/files/executive_grid.d2` |
| `fulcro_rad.d2` | `e2etests/testdata/files/fulcro_rad.d2` |
| `glob_dimensions.d2` | `e2etests/testdata/files/glob_dimensions.d2` |
| `grid_animated.d2` | `e2etests/testdata/files/grid_animated.d2` |
| `grid_container_dimensions.d2` | `e2etests/testdata/files/grid_container_dimensions.d2` |
| `grid_edge_across_cell.d2` | `e2etests/testdata/files/grid_edge_across_cell.d2` |
| `grid_even.d2` | `e2etests/testdata/files/grid_even.d2` |
| `grid_gap.d2` | `e2etests/testdata/files/grid_gap.d2` |
| `grid_icon.d2` | `e2etests/testdata/files/grid_icon.d2` |
| `grid_image_label_position.d2` | `e2etests/testdata/files/grid_image_label_position.d2` |
| `grid_label_positions.d2` | `e2etests/testdata/files/grid_label_positions.d2` |
| `grid_large_checkered.d2` | `e2etests/testdata/files/grid_large_checkered.d2` |
| `grid_nested.d2` | `e2etests/testdata/files/grid_nested.d2` |
| `grid_nested_gap0.d2` | `e2etests/testdata/files/grid_nested_gap0.d2` |
| `grid_nested_simple_edges.d2` | `e2etests/testdata/files/grid_nested_simple_edges.d2` |
| `grid_oom.d2` | `e2etests/testdata/files/grid_oom.d2` |
| `grid_outside_labels.d2` | `e2etests/testdata/files/grid_outside_labels.d2` |
| `grid_rows_gap_bug.d2` | `e2etests/testdata/files/grid_rows_gap_bug.d2` |
| `grid_tests.d2` | `e2etests/testdata/files/grid_tests.d2` |
| `grid_with_latex.d2` | `e2etests/testdata/files/grid_with_latex.d2` |
| `icon_positions.d2` | `e2etests/testdata/files/icon_positions.d2` |
| `icons_on_top.d2` | `e2etests/testdata/files/icons_on_top.d2` |
| `jupyter_aws_eks.d2` | `e2etests/testdata/files/jupyter_aws_eks.d2` |
| `jupyter_k8s_oidc.d2` | `e2etests/testdata/files/jupyter_k8s_oidc.d2` |
| `label_positions.d2` | `e2etests/testdata/files/label_positions.d2` |
| `leios_simulator.d2` | `e2etests/testdata/files/leios_simulator.d2` |
| `lion_reader_frontend.d2` | `e2etests/testdata/files/lion_reader_frontend.d2` |
| `mocha_soc.d2` | `e2etests/testdata/files/mocha_soc.d2` |
| `multiple_box_selection.d2` | `e2etests/testdata/files/multiple_box_selection.d2` |
| `multiple_constant_nears.d2` | `e2etests/testdata/files/multiple_constant_nears.d2` |
| `multiple_offset.d2` | `e2etests/testdata/files/multiple_offset.d2` |
| `multiple_offset_left.d2` | `e2etests/testdata/files/multiple_offset_left.d2` |
| `multiple_person_label.d2` | `e2etests/testdata/files/multiple_person_label.d2` |
| `nested_diagram_types.d2` | `e2etests/testdata/files/nested_diagram_types.d2` |
| `nested_layout_bug.d2` | `e2etests/testdata/files/nested_layout_bug.d2` |
| `nested_shape_labels.d2` | `e2etests/testdata/files/nested_shape_labels.d2` |
| `nesting_power.d2` | `e2etests/testdata/files/nesting_power.d2` |
| `outside_bottom_labels.d2` | `e2etests/testdata/files/outside_bottom_labels.d2` |
| `outside_grid_label_position.d2` | `e2etests/testdata/files/outside_grid_label_position.d2` |
| `overlapping_child_label.d2` | `e2etests/testdata/files/overlapping_child_label.d2` |
| `queue_workers.d2` | `e2etests/testdata/files/queue_workers.d2` |
| `ross_overview.d2` | `e2etests/testdata/files/ross_overview.d2` |
| `shaped_grid_positioning.d2` | `e2etests/testdata/files/shaped_grid_positioning.d2` |
| `simple_grid_edges.d2` | `e2etests/testdata/files/simple_grid_edges.d2` |
| `slow_grid.d2` | `e2etests/testdata/files/slow_grid.d2` |
| `spyre_encoder.d2` | `e2etests/testdata/files/spyre_encoder.d2` |
| `teleport_grid.d2` | `e2etests/testdata/files/teleport_grid.d2` |
| `tpmjs_architecture.d2` | `e2etests/testdata/files/tpmjs_architecture.d2` |
| `unconnected.d2` | `e2etests/testdata/files/unconnected.d2` |
| `unfilled_triangle.d2` | `e2etests/testdata/files/unfilled_triangle.d2` |
| `animation.d2` | `e2etests-cli/testdata/raster/animation.d2` |
| `geometry.d2` | `e2etests-cli/testdata/raster/geometry.d2` |
| `local-icon.d2` | `e2etests-cli/testdata/raster/local-icon.d2` |
| `markdown.d2` | `e2etests-cli/testdata/raster/markdown.d2` |
| `unlabelled-connection-link.d2` | `e2etests-cli/testdata/raster/unlabelled-connection-link.d2` |
