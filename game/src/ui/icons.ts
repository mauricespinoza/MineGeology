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
  hammer: '<path d="M4 7.5l6-4.5 3 2.5-1.5 1.5 9 3-1 2-9-2.5-1.5 2z"/><path d="M10.5 9l-5 11.5" stroke-width="2.6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  climb: '<path d="M6 13l6-6 6 6M6 19l6-6 6 6"/>',
  descend: '<path d="M6 5l6 6 6-6M6 11l6 6 6-6"/>',
  undo: '<path d="M9 7H4v-5"/><path d="M4 7a9 9 0 1 1-1 7"/>',
  erase: '<path d="M8 20h12"/><path d="M5.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 19H9z"/><path d="M10 11l5 5"/>',
  contact: '<path d="M3 18c4-1 5-9 9-10s5 3 9 1"/><circle cx="3" cy="18" r="1.5" fill="currentColor"/><circle cx="21" cy="9" r="1.5" fill="currentColor"/>',
  fault: '<path d="M4 20L20 4"/><path d="M7 11l3 3M14 4l3 3" opacity=".8"/><path d="M9 21l5-1-1-5M15 9l-1-5 5 1" />',
  area: '<path d="M4 8l7-5 9 4-2 11-10 3z" fill="currentColor" fill-opacity=".25"/>',
  move: '<path d="M12 2v20M2 12h20"/><path d="M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5M10.5 8v5"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M8 10.5h5"/>',
  fit: '<path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  pdf: '<path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4"/><path d="M12 10v8M8.5 14.5L12 18l3.5-3.5"/>',
  geojson: '<path d="M6 2h9l4 4v16H6z"/><path d="M15 2v4h4"/><circle cx="12.5" cy="15" r="3.5"/><path d="M9 15h7M12.5 11.5c-1.5 2-1.5 5 0 7M12.5 11.5c1.5 2 1.5 5 0 7" stroke-width="1.2"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v4h16v-4"/>',
  profileLine: '<circle cx="4" cy="17" r="2"/><circle cx="20" cy="7" r="2"/><path d="M6 16l12-8" stroke-dasharray="3 2"/><path d="M2 22h4M18 2h4" opacity=".7"/>',
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
  faultEdit: '<path d="M3 21L21 3"/><path d="M8 13l-2.5 4.5L11 16z" fill="currentColor"/><path d="M16 11l2.5-4.5L13 8z"/>',
  soundOn: '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" fill-opacity=".25"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" fill-opacity=".25"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
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

/** An icon with a short text beside it, for actions that need a word to be clear. */
export function labelledButton(name: IconName, text: string, extra = "", title = ""): string {
  const classes = ["icon-text"];
  extra = extra.replace(/class="([^"]*)"/, (_, c: string) => (classes.push(...c.split(/\s+/).filter(Boolean)), ""));
  return `<button type="button" class="${classes.join(" ")}"${title ? ` title="${attr(title)}"` : ""} ${extra}>${icon(name, 20)}<span>${text}</span></button>`;
}
