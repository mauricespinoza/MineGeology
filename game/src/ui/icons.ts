// Line icons for buttons, drawn on a 24 x 24 grid in the current text colour.
// Every icon button also carries an accessible name and a tooltip.

const PATHS = {
  notebook: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 3v18M12 8h4M12 12h4"/><path d="M3 7h3M3 12h3M3 17h3"/>',
  stereonet: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/><path d="M12 3c-5 4-5 14 0 18" stroke-dasharray="2 2"/><circle cx="15.5" cy="8.5" r="1.3" fill="currentColor"/><circle cx="16.5" cy="14" r="1.3" fill="currentColor"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  section: '<path d="M2 9l4-3 4 2 5-4 7 4"/><path d="M2 13h20M2 17h20M2 21h20" opacity=".7"/><path d="M2 9v12M22 8v13"/>',
  column: '<rect x="7" y="2.5" width="10" height="5"/><rect x="7" y="7.5" width="10" height="6"/><rect x="7" y="13.5" width="10" height="8"/><path d="M7 10.5h-3M7 17.5h-3"/>',
  evaluate: '<rect x="5" y="4" width="14" height="17" rx="1.5"/><path d="M9 4V2.5h6V4"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  fly: '<path d="M2 16l20-8-6 12-3-5z"/><path d="M13 15l9-7"/>',
  land: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M3 20h18"/>',
  // A geologist's hammer, tilted: square striking face, pick, steel neck and a rubber grip in three bands.
  hammer: '<g transform="translate(11.5 12.5) rotate(-38) translate(-12 -11)"><path d="M10.9 7.5h2.2v9h-2.2z" fill="currentColor" stroke="none"/><path d="M1.5 1.5h5v2h6l10 3.2-10 1.8h-6v2h-5z" fill="currentColor" stroke-width="1"/><rect x="10" y="14.4" width="4" height="2.4" rx=".8" fill="currentColor" stroke="none"/><rect x="10" y="17.4" width="4" height="2.2" rx=".6" fill="currentColor" stroke="none"/><rect x="10" y="20.2" width="4" height="2.8" rx="1.3" fill="currentColor" stroke="none"/></g>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  climb: '<path d="M6 13l6-6 6 6M6 19l6-6 6 6"/>',
  descend: '<path d="M6 5l6 6 6-6M6 11l6 6 6-6"/>',
  undo: '<path d="M9 7H4v-5"/><path d="M4 7a9 9 0 1 1-1 7"/>',
  erase: '<path d="M8 20h12"/><path d="M5.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 19H9z"/><path d="M10 11l5 5"/>',
  contact: '<path d="M3 4h18v16H3z" opacity=".35"/><path d="M3 15c3 0 4-6 8-7s6 4 10 2" stroke-width="2.4"/><path d="M5 19l1.5-1.5M9 19l1.5-1.5M13 19l1.5-1.5M17 19l1.5-1.5" stroke-width="1.3" opacity=".8"/>',
  fault: '<path d="M5 21L19 3" stroke-width="2.6"/><path d="M3 11l5-4M8 7l-.5 2.6M8 7l-2.6.2"/><path d="M21 13l-5 4M16 17l.5-2.6M16 17l2.6-.2"/>',
  area: '<path d="M4 8l7-5 9 4-2 11-10 3z" fill="currentColor" fill-opacity=".3"/><path d="M7 15l6-6M9 18l8-8M6 11l4-4" stroke-width="1.2" opacity=".75"/><circle cx="4" cy="8" r="1.4" fill="currentColor"/><circle cx="20" cy="7" r="1.4" fill="currentColor"/><circle cx="8" cy="21" r="1.4" fill="currentColor"/>',
  move: '<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V12M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7l-3-4.6a1.6 1.6 0 0 1 2.6-1.8L8 13.5"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5"/>',
  fit: '<path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"/><rect x="8" y="8" width="8" height="8" rx="1" opacity=".6"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  pdf: '<path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4"/><text x="12.5" y="17" text-anchor="middle" font-size="6.4" font-family="system-ui,sans-serif" font-weight="800" fill="currentColor" stroke="none">PDF</text>',
  geojson: '<path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4"/><circle cx="12.5" cy="14.5" r="4"/><path d="M8.5 14.5h8M12.5 10.5c-1.8 2.2-1.8 5.8 0 8M12.5 10.5c1.8 2.2 1.8 5.8 0 8" stroke-width="1.1"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v4h16v-4"/>',
  profileLine: '<path d="M4 18L20 6" stroke-dasharray="3 2.2"/><circle cx="4" cy="18" r="2" fill="currentColor"/><circle cx="20" cy="6" r="2" fill="currentColor"/><text x="1" y="11" font-size="8" font-family="system-ui,sans-serif" font-weight="700" fill="currentColor" stroke="none">A</text><text x="14" y="22" font-size="8" font-family="system-ui,sans-serif" font-weight="700" fill="currentColor" stroke="none">A\u2019</text>',
  lens: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21" stroke-width="3"/><path d="M7.5 8.5a3 3 0 0 1 3-2.5" opacity=".7"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M12 6l2.5 6H9.5z" fill="currentColor"/><path d="M12 18l-2.5-6h5z"/>',
  wayUp: '<path d="M3 20h18M3 16h18M3 12h18" opacity=".6"/><path d="M12 14V3M8 7l4-4 4 4"/>',
  inspect: '<path d="M3 21V9l9-3v15z" fill="currentColor" fill-opacity=".3"/><path d="M12 6l9 3v12h-9"/><path d="M12 3v20" stroke-dasharray="2 2"/>',
  kinematics: '<path d="M3 12h18"/><path d="M4 8h11M12 5l3 3-3 3"/><path d="M20 16H9M12 13l-3 3 3 3"/>',
  sample: '<path d="M6 8h12l-1 13H7z"/><path d="M9 8V5a3 3 0 0 1 6 0v3"/><path d="M10 13h4"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16"/>',
  file: '<path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4"/><path d="M9 13h6M9 17h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7v.5"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>',
  person: '<circle cx="12" cy="6" r="3.2"/><path d="M5.5 21v-5a6.5 6.5 0 0 1 13 0v5"/><path d="M9 12.5l3 3 3-3" opacity=".6"/>',
  thirdPerson: '<circle cx="15" cy="7" r="2.5"/><path d="M11.5 20v-4a3.5 3.5 0 0 1 7 0v4"/><path d="M2 14l5-3v6z" fill="currentColor" fill-opacity=".3"/>',
  firstPerson: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  faultEdit: '<path d="M3 20L15 4" stroke-width="2.4"/><path d="M6.5 15.5l-3-1 .6 3.3zM10.5 10.2l-3-1 .6 3.3z" fill="currentColor"/><path d="M14 20l1-4 6-6 3 3-6 6z" stroke-width="1.6"/>',
  soundOn: '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" fill-opacity=".25"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" fill-opacity=".25"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
  solution: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" opacity=".55"/><path d="M3 12c3-2 5 2 9 0s5-3 9-1" opacity=".55"/><circle cx="16.5" cy="15.5" r="3.6" fill="currentColor" fill-opacity=".2"/><path d="M19 18l3 3" stroke-width="2.6"/>',
  maximize: '<path d="M14 3h7v7M10 21H3v-7M21 3l-7 7M3 21l7-7"/>',
  gyro: '<rect x="8" y="5" width="8" height="14" rx="1.5"/><path d="M11 16.5h2"/><path d="M4.5 8.5a9 9 0 0 0 0 7M19.5 8.5a9 9 0 0 1 0 7"/><path d="M3 10l1.5-1.5L6 10M18 14l1.5 1.5L21 14"/>',
  cube: '<path d="M12 2.5l8.5 4.5v10L12 21.5 3.5 17V7z"/><path d="M3.5 7L12 11.5 20.5 7M12 11.5v10"/><path d="M3.5 12l8.5 4.5 8.5-4.5" opacity=".55"/>',
  drill: '<path d="M7 21l5-18 5 18"/><path d="M8.6 15h6.8M10 10h4"/><path d="M12 13v8.5" stroke-width="2.6"/><path d="M4 21h16"/>',
  // A spyglass drawn out in three tubes, eyepiece low left, the big lens up right.
  spyglass: '<g transform="rotate(-30 12 12)"><rect x="2" y="10.2" width="5" height="3.6" rx=".6"/><rect x="7" y="9.4" width="6" height="5.2" rx=".6"/><rect x="13" y="8.3" width="8.5" height="7.4" rx=".8" fill="currentColor" fill-opacity=".25"/><path d="M21.5 8.3v7.4" stroke-width="2.4"/></g>',
  pencil: '<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 24): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * An icon-only button. `label` is its accessible name and tooltip, with the key in brackets
 * where there is one; `extra` holds further attributes (id, data-*, class).
 */
export function iconButton(name: IconName, label: string, extra = ""): string {
  const classes = ["icon-btn"];
  extra = extra.replace(/class="([^"]*)"/, (_, c: string) => (classes.push(...c.split(/\s+/).filter((k) => k && k !== "icon-btn")), ""));
  return `<button type="button" class="${classes.join(" ")}" aria-label="${attr(label)}" title="${attr(label)}" ${extra}>${icon(name)}</button>`;
}

/** An icon button with a short caption under the icon, shown where there is room (wide screens). */
export function captionButton(name: IconName, caption: string, label: string, extra = ""): string {
  const classes = ["icon-btn", "cap-btn"];
  extra = extra.replace(/class="([^"]*)"/, (_, c: string) => (classes.push(...c.split(/\s+/).filter((k) => k && !classes.includes(k))), ""));
  return `<button type="button" class="${classes.join(" ")}" aria-label="${attr(label)}" title="${attr(label)}" ${extra}>${icon(name)}<span class="cap">${caption}</span></button>`;
}

/** An icon with a short text beside it, for actions that need a word to be clear. */
export function labelledButton(name: IconName, text: string, extra = "", title = ""): string {
  const classes = ["icon-text"];
  extra = extra.replace(/class="([^"]*)"/, (_, c: string) => (classes.push(...c.split(/\s+/).filter(Boolean)), ""));
  return `<button type="button" class="${classes.join(" ")}"${title ? ` title="${attr(title)}"` : ""} ${extra}>${icon(name, 20)}<span>${text}</span></button>`;
}
