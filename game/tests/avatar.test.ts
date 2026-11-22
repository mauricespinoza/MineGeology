import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HAIR_STYLES, type HairLength, SKIN_TONES, defaultAvatar, parseAvatar } from "../src/state/avatar";
import { buildAvatar } from "../src/world/avatar";

const colours = (g: THREE.Object3D) => {
  const out = new Set<string>();
  g.traverse((o) => o instanceof THREE.Mesh && out.add(`#${(o.material as THREE.MeshLambertMaterial).color.getHexString()}`));
  return out;
};
const top = (g: THREE.Object3D) => new THREE.Box3().setFromObject(g).max.y;

describe("the field geologist", () => {
  it("reads back what was saved, and falls back to the default for anything wrong", () => {
    const a = { ...defaultAvatar(), skin: 6, hat: "sombrero", vest: false };
    expect(parseAvatar(JSON.stringify(a))).toEqual(a);
    expect(parseAvatar(null)).toEqual(defaultAvatar());
    expect(parseAvatar("{not json")).toEqual(defaultAvatar());
    const bad = parseAvatar(JSON.stringify({ figure: "x", skin: 99, hat: "corona", shirtColour: "red", vest: "sí" }));
    expect(bad).toEqual(defaultAvatar());
  });

  it("wears the chosen skin tone and gear", () => {
    for (const skin of [0, 4, 7]) expect(colours(buildAvatar({ ...defaultAvatar(), skin }).group).has(SKIN_TONES[skin]!)).toBe(true);
    const bare = buildAvatar({ ...defaultAvatar(), hat: "ninguno", vest: false, backpack: false, lens: false }).group;
    const full = buildAvatar(defaultAvatar()).group;
    expect(full.children.length).toBeGreaterThan(bare.children.length + 8);
    expect(top(full)).toBeGreaterThan(top(bare)); // the helmet stands above the hair
    expect(top(bare)).toBeCloseTo(1.85, 1); // about as tall as a person, in metres
  });

  it("is one geologist: a figure saved by an older version is ignored", () => {
    const old = parseAvatar(JSON.stringify({ ...defaultAvatar(), figure: "femenino", skin: 3 }));
    expect(old).toEqual({ ...defaultAvatar(), skin: 3 });
    expect("figure" in old).toBe(false);
  });

  it("holds the hammer in a closed fist, with the head above the hand", () => {
    const m = buildAvatar(defaultAvatar());
    const grip = m.armR.children.at(-1)!;
    expect(grip.children.length).toBe(2); // the fist and the hammer
    const [fist, hammer] = grip.children as [THREE.Object3D, THREE.Object3D];
    expect(fist.children.length).toBeGreaterThan(8); // palm, fingers, fingertips and thumb
    const head = new THREE.Box3().setFromObject(hammer.children.at(-1)!);
    expect(head.max.y).toBeGreaterThan(new THREE.Box3().setFromObject(fist).max.y);
  });

  it("keeps the hair length and style, and a style the length does not allow falls back to loose", () => {
    const a = { ...defaultAvatar(), hairLength: "largo", hairStyle: "trenza" };
    expect(parseAvatar(JSON.stringify(a))).toEqual(a);
    expect(parseAvatar(JSON.stringify({ ...a, hairLength: "corto" })).hairStyle).toBe("suelto");
    expect(parseAvatar(JSON.stringify({ ...a, hairLength: "calvo", hairStyle: "rastas" }))).toMatchObject({ hairLength: "corto", hairStyle: "suelto" });
  });

  it("builds every length with every style it allows, and longer hair falls lower", () => {
    const bottom = (length: HairLength) => {
      const g = buildAvatar({ ...defaultAvatar(), hairLength: length, hairStyle: "suelto", hat: "ninguno", backpack: false }).group;
      let low = Infinity;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh && (o.material as THREE.MeshLambertMaterial).color.getHexString() === "4a3020") low = Math.min(low, new THREE.Box3().setFromObject(o).min.y);
      });
      return low;
    };
    expect(bottom("largo")).toBeLessThan(bottom("medio"));
    expect(bottom("medio")).toBeLessThan(bottom("corto"));
    for (const length of Object.keys(HAIR_STYLES) as HairLength[])
      for (const hairStyle of HAIR_STYLES[length])
        for (const backpack of [true, false]) expect(buildAvatar({ ...defaultAvatar(), hairLength: length, hairStyle, backpack }).group.children.length).toBeGreaterThan(20);
    const locks = (hairStyle: "suelto" | "coleta" | "trenzas") => buildAvatar({ ...defaultAvatar(), hairLength: "largo", hairStyle }).group.children.filter((o) => o instanceof THREE.Group && !(o instanceof THREE.Mesh) && o.children.length > 2 && o.position.y > 1.6).length;
    expect([locks("suelto"), locks("coleta"), locks("trenzas")]).toEqual([0, 1, 2]); // the tails hang from the head
  });
});
