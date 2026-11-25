// @ts-check
// What other players may see of a garden: positions, growth timing and fruit looks, but no prices.
import { avatarOf } from './estate.js';

export function publicPlant(p) {
  return {
    id: p.id, crop: p.crop, x: p.x, z: p.z,
    cycle: p.cycle, cycleStart: p.cycleStart, ck: p.ck, work: p.work, readyAt: p.readyAt,
    watered: p.watered, buddy: p.buddy,
    env: p.env?.length ? [...p.env] : undefined,
    fruit: p.fruit ? p.fruit.map((f) => ({ v: f.variant, b: f.big, e: f.env })) : null,
  };
}

export function publicEffect(e) {
  return { id: e.id, kind: e.kind, x: e.x, z: e.z, from: e.from, to: e.to };
}

export function publicGarden(state) {
  return {
    soil: state.soil,
    plants: state.plants.map(publicPlant),
    effects: state.effects.map(publicEffect),
    home: state.home ?? 0,
    decor: (state.decor ?? []).map((d) => ({ id: d.id, kind: d.kind, x: d.x, z: d.z, rot: d.rot })),
    pets: (state.pets ?? []).filter((p) => p.equipped).map((p) => ({ id: p.id, kind: p.kind, level: p.level })),
    eggs: (state.eggs ?? []).map((e) => ({ id: e.id, kind: e.kind, ready: e.ready })),
  };
}

/** What other players see about a member (nametag, avatar). */
export function publicProfile(state) {
  return { avatar: avatarOf(state), title: state.title ?? '', stars: state.rebirths ?? 0, holder: state.holder ?? null, club: !!state.club?.active };
}

/** Private view sent only to the owner. */
export function privateState(state) {
  const { lastSeq, ...rest } = state;
  return rest;
}
