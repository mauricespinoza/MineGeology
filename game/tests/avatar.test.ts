import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SKIN_TONES, defaultAvatar, parseAvatar } from "../src/state/avatar";
import { buildAvatar } from "../src/world/avatar";

const colours = (g: THREE.Object3D) => {
  const out = new Set<string>();
  g.traverse((o) => o instanceof THREE.Mesh && out.add(`#${(o.material as THREE.MeshLambertMaterial).color.getHexString()}`));
  return out;
};
const top = (g: THREE.Object3D) => new THREE.Box3().setFromObject(g).max.y;

describe("the field geologist", () => {
  it("reads back what was saved, and falls back to the default for anything wrong", () => {
    const a = { ...defaultAvatar(), figure: "masculino", skin: 6, hat: "sombrero", vest: false };
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

  it("has two figures that differ in build and hair, not in what they can wear", () => {
    const f = buildAvatar({ ...defaultAvatar(), figure: "femenino" }), m = buildAvatar({ ...defaultAvatar(), figure: "masculino" });
    expect(Math.abs(f.armR.position.x)).toBeLessThan(Math.abs(m.armR.position.x)); // narrower shoulders
    expect(f.group.children.length).toBeGreaterThan(m.group.children.length); // longer hair and ponytail
  });
});
