// Meshes chunks off the main thread. The grid is sent once; each request returns transferable buffers.

import type { Grid } from "./blocks";
import { buildChunk } from "./mesher";

let grid: Grid | null = null;

self.onmessage = (event: MessageEvent<{ grid?: Grid; cx?: number; cy?: number; sub?: number }>) => {
  if (event.data.grid) {
    grid = event.data.grid;
    return;
  }
  if (!grid) return;
  const { cx, cy, sub } = event.data as { cx: number; cy: number; sub: number };
  const mesh = buildChunk(grid, cx, cy, sub);
  (self as unknown as Worker).postMessage(
    { cx, cy, sub, mesh },
    [mesh.positions.buffer, mesh.normals.buffer, mesh.colours.buffer, mesh.indices.buffer],
  );
};
