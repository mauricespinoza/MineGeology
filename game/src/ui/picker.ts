// The start screen: the published scenarios, from index.json next to the game.

export interface ScenarioEntry {
  folder: string;
  scenario_id: string;
  variant: string;
  title: string;
  level: number;
  summary?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The list of scenarios, or null when the site has no index (a single scenario). */
export async function loadIndex(): Promise<ScenarioEntry[] | null> {
  try {
    const response = await fetch("./index.json");
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return null;
    const doc = (await response.json()) as { scenarios?: ScenarioEntry[] };
    return Array.isArray(doc.scenarios) && doc.scenarios.length ? doc.scenarios : null;
  } catch {
    return null;
  }
}

/** Fills `list` with one card per scenario; variants of a scenario share a card. */
export function renderPicker(list: HTMLElement, entries: ScenarioEntry[], hasSave: (e: ScenarioEntry) => boolean): void {
  const groups = new Map<string, ScenarioEntry[]>();
  for (const e of entries) groups.set(e.scenario_id, [...(groups.get(e.scenario_id) ?? []), e]);
  list.innerHTML = [...groups.values()]
    .map((variants) => {
      const first = variants[0]!;
      const links = variants
        .map((v) => `<a class="pick" href="?s=${encodeURIComponent(v.folder)}" data-folder="${esc(v.folder)}">Variante ${esc(v.variant.toUpperCase())}${hasSave(v) ? " · continuar" : ""}</a>`)
        .join("");
      return `<div class="pick-card"><div class="pick-head"><b>${esc(first.title)}</b><span>Nivel ${first.level}</span></div>${first.summary ? `<p>${esc(first.summary)}</p>` : ""}<div class="pick-links">${links}</div></div>`;
    })
    .join("");
  list.hidden = false;
}
