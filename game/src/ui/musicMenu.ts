// The choice of music: a small menu by the sound button, and a picker on the start screen.

import { MUSIC_STYLES, type MusicStyle, type Sound } from "../audio/sound";
import { esc } from "./html";
import { icon } from "./icons";

/** The menu opened by the sound button: sound on or off, and the style of music. */
export class MusicMenu {
  private readonly onDocDown = (e: Event) => {
    const t = e.target as Node;
    if (!this.root.contains(t) && !this.button.contains(t)) this.hide();
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly button: HTMLButtonElement,
    private readonly sound: Sound,
    private readonly changed: () => void,
  ) {
    root.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-music], [data-do]");
      if (!target) return;
      if (target.dataset.music) {
        if (!sound.enabled) sound.setEnabled(true);
        sound.setMusic(target.dataset.music as MusicStyle);
      } else if (target.dataset.do === "toggle") sound.setEnabled(!sound.enabled);
      this.render();
      this.changed();
    });
    button.onclick = () => (this.isOpen ? this.hide() : this.open(), button.blur());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.render();
    this.root.hidden = false;
    document.addEventListener("pointerdown", this.onDocDown, true);
  }

  hide(): void {
    this.root.hidden = true;
    document.removeEventListener("pointerdown", this.onDocDown, true);
  }

  private render(): void {
    const { sound } = this;
    this.root.innerHTML = `
      <div class="music-head">Música de fondo</div>
      ${MUSIC_STYLES.map(
        (m) => `<button type="button" role="menuitemradio" aria-checked="${sound.enabled && sound.style === m.id}" data-music="${m.id}"
          class="${sound.enabled && sound.style === m.id ? "on" : ""}"><b>${esc(m.name)}</b><small>${esc(m.hint)}</small></button>`,
      ).join("")}
      <button type="button" data-do="toggle" class="music-toggle">${icon(sound.enabled ? "soundOff" : "soundOn")} ${sound.enabled ? "Silenciar todo" : "Activar el sonido"}</button>`;
  }
}

/** A picker for the start screen, kept in step with the menu. */
export function musicPicker(select: HTMLSelectElement, sound: Sound): void {
  select.innerHTML =
    MUSIC_STYLES.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("") + `<option value="off">Sin sonido</option>`;
  select.value = sound.enabled ? sound.style : "off";
  select.onchange = () => {
    if (select.value === "off") sound.setEnabled(false);
    else {
      sound.setMusic(select.value as MusicStyle);
      if (!sound.enabled) sound.setEnabled(true);
    }
  };
}
