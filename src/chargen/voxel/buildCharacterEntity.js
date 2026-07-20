import { Vec3 } from './Vec3.js'
import { buildPart } from './buildCreatureRender.js'

/**
 * New (provisional) character system — independent from src/Player.js so the game
 * keeps running while we iterate. Once stable we'll port bootSP / Player to it.
 *
 * A character is two things:
 *   1. A *data* definition (parts, palette, body plan, concepts, collision).
 *   2. A *rig template* picked by `bodyPlan` that knows how to animate the slot
 *      names the parts declare. Rigs live under src/character/rigs/.
 *
 * `buildCharacterEntity` produces the entity-shaped object the engine expects:
 * `entity.render` is a primitive group whose children carry the slot names so
 * the rig can find them via `Object3D.getObjectByName`.
 *
 * The inner `buildPart` lives in ./buildCreatureRender.js so the local
 * creature library can hydrate render trees without a Vec3 / engine dependency.
 */

/**
 * Build an engine entity from a character def. Caller supplies an id + position;
 * the def supplies render/concepts/collision.
 *
 * Outfits (optional): each outfit is a data def from src/character/outfits/
 * that lists `attachments`, where each attachment names a target slot in
 * the base character and provides extra `parts` to merge as children of
 * that slot's mesh. Outfit concepts and palette entries are merged in.
 *
 * Palette precedence (later wins): base def → each outfit (in order) →
 * explicit `palette` arg. Outfit palette only fills in keys the base
 * doesn't define, except where overridden by the explicit param.
 *
 * Slot resolution is recursive — outfits can target nested slots (e.g.
 * `snout`, `ear-L`) just as easily as top-level ones (`body`, `head`).
 */
export function buildCharacterEntity(def, { id, name = def.label ?? def.id, pos, palette, outfits = [] } = {}) {
  if (!def) throw new Error('buildCharacterEntity: missing def')
  if (!id) throw new Error('buildCharacterEntity: missing id')

  // Palette merge: base → outfits (filling in only) → explicit override.
  const finalPalette = { ...(def.palette ?? {}) }
  for (const outfit of outfits) {
    for (const [k, v] of Object.entries(outfit?.palette ?? {})) {
      if (!(k in finalPalette)) finalPalette[k] = v
    }
  }
  Object.assign(finalPalette, palette ?? {})

  // Build the base parts tree first; outfits then graft their parts onto
  // the matching slots. Done as a post-pass (not interleaved) so an outfit
  // can't accidentally see another outfit's contributions when looking up
  // its target slot — the lookup table is the BASE tree only.
  const baseParts = (def.parts ?? []).map((p) => buildPart(p, finalPalette))
  for (const outfit of outfits) {
    if (!outfit) continue
    for (const att of outfit.attachments ?? []) {
      const target = findPartBySlot(baseParts, att.slot)
      if (!target) {
        console.warn(`[outfit ${outfit.id}] slot "${att.slot}" not found in base "${def.id}"`)
        continue
      }
      target.children = target.children ?? []
      for (const p of att.parts ?? []) target.children.push(buildPart(p, finalPalette))
    }
  }

  // Concept merge: base + every outfit's concepts + archetype tags (de-duped).
  // 'creature' and 'mobile' are added universally because every character built
  // through this path is an autonomous mobile entity by definition. See
  // docs/game-design.md "Entity archetypes" — generated spells discriminate on
  // these tags. 'solid' has been auto-added since the character system shipped.
  const concepts = new Set([...(def.concepts ?? []), 'solid', 'creature', 'mobile'])
  for (const outfit of outfits) {
    for (const c of outfit?.concepts ?? []) concepts.add(c)
  }

  return {
    id,
    name,
    pos: pos ? pos.clone() : new Vec3(0, 0, 0),
    vel: new Vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    _grounded: true,
    concepts: Array.from(concepts),
    collision: def.collision ?? { kind: 'cylinder', radius: 0.4, height: 1.0, body: 'solid' },
    render: {
      kind: 'group',
      name: def.id,
      children: baseParts
    },
    character: {
      defId: def.id,
      palette: finalPalette,
      outfitIds: outfits.filter(Boolean).map((o) => o.id),
      // Optional per-character rig overrides. Each rig is free to read the
      // keys it cares about (e.g. QuadrupedRig reads `tailCurl`); unknown
      // keys are silently ignored. Authors set this on the character def
      // to bias rig behavior without forking the rig itself — letting one
      // QuadrupedRig drive a perky dog AND a dragging dragon by config
      // alone. Stays as a plain object so future fields can be added
      // without touching this builder.
      rigConfig: def.rigConfig ?? {}
    }
  }
}

// Recursive DFS for a slot/name match. Returned reference is mutated by
// the outfit merge above (children gets appended), so this MUST return the
// actual tree node, not a copy.
function findPartBySlot(parts, slot) {
  for (const p of parts) {
    if (p.name === slot) return p
    if (Array.isArray(p.children)) {
      const hit = findPartBySlot(p.children, slot)
      if (hit) return hit
    }
  }
  return null
}
