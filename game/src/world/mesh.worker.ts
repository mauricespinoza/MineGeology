// Meshes chunks off the main thread. The grid is sent once; each request returns transferable buffers.

import { type Grid, SUB } from "./blocks";
import { buildChunk } from "./mesher";

let grid: Grid | null = null;

self.onmessage = (event: MessageEvent<{ grid?: Grid; dig?: [number, number]; clearDigs?: boolean; cx?: number; cy?: number; sub?: number }>) => {
  if (event.data.grid) {
    grid = event.data.grid;
    return;
  }
  // A block broken with the hammer, or all of them mended for a new attempt: the worker keeps its own copy.
  if (event.data.dig && grid) {
    grid.dug ??= new Uint8Array(grid.nx * grid.ny * SUB * SUB);
    grid.dug[event.data.dig[0]] = event.data.dig[1];
    return;
  }
  if (event.data.clearDigs && grid) {
    grid.dug = undefined;
    return;
  }
  if (!grid) return;
  const { cx, cy, sub } = event.data as { cx: number; cy: number; sub: number };
  const mesh = buildChunk(grid, cx, cy, sub);
  (self as unknown as Worker).postMessage(
    { cx, cy, sub, mesh },
    [mesh.positions.buffer, mesh.normals.buffer, mesh.colours.buffer, mesh.patterns.buffer, mesh.indices.buffer],
  );
};
