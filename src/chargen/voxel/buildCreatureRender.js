/**
 * buildCreatureRender — pure render-tree builder for local authored
 * creature definitions.
 *
 * Spec: docs/specs/zookeeper.md.
 *
 * Why a separate file from buildCharacterEntity:
 *   - buildCharacterEntity imports Vec3 and produces a full engine
 *     entity (pos, vel, yaw, character.*).
 *   - This file intentionally stays dependency-free (no Vec3, no THREE,
 *     no engine coupling) so render hydration is easy to test.
 *
 * Accepts both the in-repo def shape (camelCase: `bodyPlan`,
 * `rigConfig`) and the DB-row shape (snake_case: `body_plan`,
 * `rig_config`). Anything inside `parts` / `palette` is the same
 * shape on both sides, so this normalization only matters at the
 * top level.
 */

const MAGENTA = 0xff00ff

function resolveColor(ref, palette) {
  if (typeof ref === 'number') return ref
  if (typeof ref === 'string' && palette && ref in palette) {
    const v = palette[ref]
    // Palette entries are usually number literals, but DB JSONB may
    // round-trip as strings like '0xff8833' or '#ff8833'. Tolerate both
    // so the same module hydrates client + Edge defs identically.
    if (typeof v === 'number') return v
    if (typeof v === 'string') return parseHexColor(v)
  }
  return MAGENTA
}

function parseHexColor(s) {
  const trimmed = s.trim()
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    return Number.parseInt(trimmed.slice(2), 16)
  }
  if (trimmed.startsWith('#')) {
    return Number.parseInt(trimmed.slice(1), 16)
  }
  const n = Number(trimmed)
  if (Number.isFinite(n)) return n
  return MAGENTA
}

function applyTint(color, tint) {
  if (tint == null) return color
  const r = (color >> 16) & 0xff
  const g = (color >> 8) & 0xff
  const b = color & 0xff
  const tr = (tint >> 16) & 0xff
  const tg = (tint >> 8) & 0xff
  const tb = tint & 0xff
  // Component-wise multiply on normalized 0-1 channels, then quantize
  // back. Clamp to 8 bits per channel per spec §10.2.
  const nr = Math.min(255, Math.max(0, Math.round((r * tr) / 255)))
  const ng = Math.min(255, Math.max(0, Math.round((g * tg) / 255)))
  const nb = Math.min(255, Math.max(0, Math.round((b * tb) / 255)))
  return (nr << 16) | (ng << 8) | nb
}

function buildPart(part, palette, tint) {
  const node = {
    kind: part.kind,
    name: part.slot,
    color: applyTint(resolveColor(part.color, palette), tint),
    // Outlines default off — buildCharacterEntity carries the same
    // default. Voxel silhouettes carry enough read on their own.
    outline: part.outline ?? false
  }
  if (Array.isArray(part.size)) {
    node.size = { x: part.size[0], y: part.size[1], z: part.size[2] }
  }
  if (part.radius != null) node.radius = part.radius
  if (part.height != null) node.height = part.height
  if (part.tube != null) node.tube = part.tube
  if (Array.isArray(part.offset)) node.offset = part.offset.slice()
  if (Array.isArray(part.rotation)) node.rotation = part.rotation.slice()
  if (part.emissive != null) {
    node.emissive = applyTint(resolveColor(part.emissive, palette), tint)
  }
  if (part.emissiveIntensity != null) node.emissiveIntensity = part.emissiveIntensity
  if (part.opacity != null) node.opacity = part.opacity
  if (part.castShadow != null) node.castShadow = part.castShadow
  if (part.receiveShadow != null) node.receiveShadow = part.receiveShadow
  if (part.pivot != null) node.pivot = part.pivot
  if (part.wobble != null) node.wobble = part.wobble
  if (Array.isArray(part.children) && part.children.length) {
    node.children = part.children.map((c) => buildPart(c, palette, tint))
  }
  return node
}

/**
 * Pure shape: (def, opts) -> renderTree.
 *
 *   def     — creature def in either in-repo (camelCase) or DB (snake_case) top-level shape
 *   opts.tint — optional 0xRRGGBB multiplier applied component-wise to every resolved color
 *
 * Throws if `def` is missing required fields.
 */
export function buildCreatureRender(def, { tint } = {}) {
  if (!def || typeof def !== 'object') {
    throw new Error('buildCreatureRender: missing def')
  }
  const id = def.id
  if (typeof id !== 'string' || !id.length) {
    throw new Error('buildCreatureRender: def.id missing')
  }
  if (!Array.isArray(def.parts)) {
    throw new Error(`buildCreatureRender(${id}): def.parts must be an array`)
  }
  const palette = def.palette ?? {}
  const children = def.parts.map((p) => buildPart(p, palette, tint))
  return {
    kind: 'group',
    name: id,
    children
  }
}

// Named exports for in-repo callers (buildCharacterEntity) that want to
// reuse the part-building logic with character-specific palette merging.
// Callers that only need a render tree should prefer `buildCreatureRender`.
export { buildPart, resolveColor, applyTint, parseHexColor }
