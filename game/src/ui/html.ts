/** Escapes text for use inside HTML. */
export function esc(text: string | number): string {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Field time as "Día 2, 10:35". */
export function when(day: number, minutes: number): string {
  const total = 8 * 60 + Math.floor(minutes);
  return `Día ${day}, ${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
