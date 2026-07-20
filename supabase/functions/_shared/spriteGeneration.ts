// Shared sprite generation utilities for Edge Functions
//
// Two providers:
//  - Replicate (flux) + rembg/BiRefNet bg removal — infinite-kitchen's path,
//    used when REPLICATE_API_TOKEN is set
//  - Vertex AI (gemini image model) + local white-key background removal —
//    no extra vendor, same service account the text models use
import { vertexAI } from './vertexGemini.ts'

const REPLICATE_API_TOKEN = Deno.env.get('REPLICATE_API_TOKEN')
const REPLICATE_MODEL_PRO = 'black-forest-labs/flux-2-pro'
const REPLICATE_MODEL_KLEIN = 'black-forest-labs/flux-2-klein-4b'
const VERTEX_IMAGE_MODEL = Deno.env.get('SPRITE_IMAGE_MODEL') ?? 'gemini-2.5-flash-image'

// Build sprite generation prompt with visual hints
export function buildSpritePrompt(ingredientName: string, inputIngredientNames?: string[], description?: string, promptHint?: string): string {
  const nameLower = ingredientName.toLowerCase()
  let visualHint = ''

  // Add visual hints for common processing states
  if (nameLower.includes('sliced')) {
    visualHint = 'Multiple thin slices fanned out or stacked.'
  } else if (nameLower.includes('diced')) {
    visualHint = 'A pile of small cubes.'
  } else if (nameLower.includes('chopped')) {
    visualHint = 'Roughly cut irregular chunks.'
  } else if (nameLower.includes('minced')) {
    visualHint = 'Very finely chopped tiny bits.'
  } else if (nameLower.includes('julienned') || nameLower.includes('julienne')) {
    visualHint = 'Thin matchstick strips.'
  } else if (nameLower.includes('grated') || nameLower.includes('shredded')) {
    visualHint = 'Pile of shredded strands or gratings.'
  } else if (nameLower.includes('mashed')) {
    visualHint = 'Smooth or chunky mashed paste.'
  } else if (nameLower.includes('halved') || nameLower.includes('half')) {
    visualHint = 'Cut in half showing cross-section.'
  } else if (nameLower.includes('quartered')) {
    visualHint = 'Cut into four pieces.'
  } else if (nameLower.includes('crushed')) {
    visualHint = 'Crushed into broken fragments.'
  } else if (nameLower.includes('ground')) {
    visualHint = 'Ground into powder or meal.'
  } else if (nameLower.includes('zested')) {
    visualHint = 'Fine curls of outer peel.'
  } else if (nameLower.includes('juiced') || nameLower.includes('juice')) {
    visualHint = 'Liquid in a small puddle.'
  } else if (nameLower.includes('melted')) {
    visualHint = 'Melted liquid state.'
  } else if (nameLower.includes('frozen')) {
    visualHint = 'Covered in frost or ice crystals.'
  } else if (nameLower.includes('whipped')) {
    visualHint = 'Fluffy with soft peaks.'
  } else if (nameLower.includes('mix')) {
    visualHint = 'Multiple ingredients combined together, showing distinct elements of each.'
  }

  // Build the "made from" hint if we have input ingredients
  const madeFromHint = inputIngredientNames && inputIngredientNames.length > 0
    ? `Made from: ${inputIngredientNames.join(', ')}.`
    : ''

  const descriptionHint = description ? `Description: ${description}` : ''
  const adminHint = promptHint ? `Visual override: ${promptHint}` : ''

  return `A 2D game sprite of "${ingredientName}" for a cooking game.
${descriptionHint}
${madeFromHint}
${adminHint || (visualHint ? `Visual: ${visualHint}` : '')}
Style: Hand-drawn illustration, warm cozy aesthetic, slightly stylized.
View: 3/4 top-down isometric angle.
Requirements:
- ONLY the ingredient, floating with NO plate, bowl, surface, or container
- Solid flat white background (#FFFFFF), completely uniform
- No shadows, no gradients, no vignette
- Clean sharp edges
- Warm colors, appetizing appearance
- No text or labels
Output: Square format, clean illustration.`
}

// Generate sprite with Replicate
export async function generateSprite(ingredientName: string, inputIngredientNames?: string[], description?: string, promptHint?: string): Promise<string> {
  if (!REPLICATE_API_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN not configured')
  }

  const prompt = buildSpritePrompt(ingredientName, inputIngredientNames, description, promptHint)

  const createResponse = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MODEL_PRO}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        prompt: prompt,
        aspect_ratio: 'custom',
        width: 256,
        height: 256,
        output_format: 'png',
        safety_tolerance: 5,
      }
    })
  })

  if (!createResponse.ok) {
    const error = await createResponse.text()
    throw new Error(`Replicate API error: ${error}`)
  }

  const prediction = await createResponse.json()

  // Poll for completion
  let result = prediction
  while (result.status !== 'succeeded' && result.status !== 'failed') {
    await new Promise(resolve => setTimeout(resolve, 500))
    const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
    })
    result = await pollResponse.json()
  }

  if (result.status === 'failed') {
    throw new Error(`Replicate generation failed: ${result.error}`)
  }

  return Array.isArray(result.output) ? result.output[0] : result.output
}

// Generate sprite with Replicate Klein (cheaper, ~512x512 output)
export async function generateSpriteKlein(ingredientName: string, inputIngredientNames?: string[], description?: string): Promise<string> {
  if (!REPLICATE_API_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN not configured')
  }

  const prompt = buildSpritePrompt(ingredientName, inputIngredientNames, description)

  const createResponse = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MODEL_KLEIN}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        prompt: prompt,
        aspect_ratio: '1:1',
        output_megapixels: '0.25',
        output_format: 'png',
      }
    })
  })

  if (!createResponse.ok) {
    const error = await createResponse.text()
    throw new Error(`Replicate Klein API error: ${error}`)
  }

  const prediction = await createResponse.json()

  let result = prediction
  while (result.status !== 'succeeded' && result.status !== 'failed') {
    await new Promise(resolve => setTimeout(resolve, 500))
    const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
    })
    result = await pollResponse.json()
  }

  if (result.status === 'failed') {
    throw new Error(`Replicate Klein generation failed: ${result.error}`)
  }

  return Array.isArray(result.output) ? result.output[0] : result.output
}

// Build badge sprite prompt — anime-style pin badge.
// Avoid brand/character names (e.g. "Studio Ghibli", "Totoro") — Flux's safety
// classifier (E005) flags copyrighted references, causing ~100% reject rate
// on full-template generations. Empirically probed 2026-04-20.
export function buildBadgeSpritePrompt(badgeTitle: string, badgeDescription: string, emoji: string): string {
  return `A cute collectible enamel pin badge for a cooking game achievement called "${badgeTitle}".
The badge represents: ${badgeDescription}
Visual theme inspired by the emoji: ${emoji}
Style: hand-painted watercolor anime pin — the kind you'd pin to a tote bag or apron. Soft warm colors, charming and whimsical. Each badge has its own unique silhouette shape based on the theme (e.g. a loaf of bread shape for baking, a bowl shape for soup, a noodle swirl for pasta).
View: Front-facing, centered, floating.
Requirements:
- Unique pin silhouette shape that IS the subject (the bread, the egg, the bowl, etc.) — NOT a generic shield or circle frame
- Soft hand-painted watercolor style with warm muted tones, like a cozy food illustration
- Thin gold or bronze metallic edge outline giving it that enamel pin feel
- Charming, cozy, slightly stylized
- Small and compact — reads clearly at tiny sizes
- Solid flat white background (#FFFFFF), completely uniform
- No shadows on background, no gradients, no vignette
- No text or labels
Output: Square format, clean illustration on white background.`
}

// Build chef rank sprite prompt — French honor-inspired rank emblem with per-level visual
export function buildRankSpritePrompt(rankName: string, description: string, emoji: string, promptHint?: string): string {
  const visualDescription = promptHint
    ? promptHint
    : 'A circular fabric rosette with pleated petals and a short decorative ribbon tail hanging below.'

  return `A French culinary honor award for a cooking game, inspired by the Légion d'Honneur and Meilleur Ouvrier de France traditions.
${visualDescription}
Style: Studio Ghibli / anime hand-painted watercolor. Warm muted tones, soft cel shading, charming and cozy like a Miyazaki kitchen scene.
View: Front-facing, centered.
Requirements:
- Soft hand-painted watercolor style with visible brushstrokes
- Warm colors — cream, gold, dusty rose, sage, soft blue
- Charming, cozy, slightly stylized
- Solid flat white background (#FFFFFF), completely uniform
- No shadows on background, no gradients, no vignette
- ABSOLUTELY NO TEXT, NO LETTERS, NO WORDS, NO NUMBERS, NO LABELS — purely visual illustration
- No text or writing of any kind anywhere in the image
Output: Square format, clean illustration on white background.`
}

// Build customer character image prompt — full-bleed square head-and-shoulders
// portrait of a restaurant customer with the dining room interior in the
// background. Cropped to a circle at render time (admin tab + restaurant scene).
export function buildCustomerImagePrompt(name: string, description: string, promptHint?: string): string {
  const subject = promptHint
    ? `${promptHint} (named "${name}")`
    : `a character named "${name}"`

  return `A square head-and-shoulders portrait of ${subject}, a customer in a cozy cooking game restaurant.
Character description: ${description || 'A friendly customer enjoying a meal.'}
Composition: Head and shoulders bust shot, character centred and filling most of the frame, looking roughly toward the viewer. The dining room interior is visible behind them — wood panelling, warm lamplight, a hint of a table or chair, soft bokeh background. The character should be centred so the image can be cropped to a circle for an avatar at render time.
Style: Hand-painted watercolor anime style with a warm cozy aesthetic. Soft cel shading with clean confident line work. Expressive friendly face with large bright eyes and a gentle smile. Visible watercolor washes and brush strokes, golden-hour lighting catching the edges, soft bokeh on the dining room background. Charming, inviting, slightly nostalgic — like an illustration from a hand-painted children's cookbook.
Colors: Muted warm palette — cream, amber, soft gold, dusty rose, gentle sage accents. Avoid neon or oversaturated colors.
Requirements:
- Character is clearly visible, friendly, centred in the frame
- Restaurant interior visible behind them but soft and out-of-focus
- The whole square image is filled with the scene — NO white border, NO circular vignette, NO frame
- Bleed to all four edges of the square
- No text, no labels, no logos
- Single character only — no other people in frame
Output: Square format, full-bleed hand-painted watercolor portrait that will be circle-cropped at render time.`
}

// Build restaurant background prompt — top-down view of an empty restaurant
// interior. No customers, no kitchen tools — those are overlaid by Phaser at
// runtime over the slot positions defined per tier.
export function buildRestaurantBgPrompt(tierName: string, description: string, promptHint?: string): string {
  const subject = promptHint
    ? `${promptHint} ("${tierName}")`
    : `a "${tierName}" restaurant interior`

  return `A top-down isometric view of ${subject} for a cooking game.
Tier description: ${description || 'A cozy restaurant ready for customers.'}
Composition: Top-down 3/4 isometric view of the empty restaurant interior, showing the floor, tables (without customers), windows, walls, and entrance/door area. Leave clear floor space where customer tokens will be placed at runtime. Leave a strip along the top edge clear for a kitchen counter / tool bench.
Style: Hand-painted watercolor anime style with a warm cozy aesthetic. Soft cel shading with clean confident line work. Visible watercolor washes and brush strokes throughout, warm golden lamplight pooling on tables and floor, soft bokeh on the deeper parts of the scene. Charming, inviting, slightly nostalgic — like an illustration from a hand-painted children's cookbook.
Colors: Muted warm palette — cream, amber, soft wood browns, dusty rose, gentle sage accents. Avoid neon or oversaturated colors.
Requirements:
- Top-down 3/4 view, NOT first-person
- Empty floor — NO people, NO customers, NO chefs
- NO kitchen tools, NO appliances, NO food on tables (these are added by the game)
- Tables visible but EMPTY
- Door / entrance clearly visible (customers walk in from there)
- Solid flat edges, no vignette around the image itself
- No text, no labels, no signage
Output: Wide format (16:9), hand-painted watercolor illustration.`
}

// Build tool sprite prompt for full-size placed tools (stove, oven, etc.)
export function buildToolSpritePrompt(toolName: string, isHoldable: boolean, actionVerb?: string, promptHint?: string): string {
  if (isHoldable) {
    return buildToolIconPrompt(toolName, actionVerb, promptHint)
  }

  const subject = promptHint
    ? `${promptHint} ("${toolName}")`
    : `a "${toolName}" kitchen appliance`

  return `A hand-drawn watercolor illustration of ${subject} for a cooking game.
${actionVerb ? `This tool is used to ${actionVerb} food.` : ''}
Style: Hand-painted watercolor with visible ink outlines, like an illustration from a vintage cookbook or recipe journal. Loose organic brushwork with warm watercolor washes. Delicate pen linework defining edges and details. The feel of a beautiful hand-illustrated kitchen field guide — warm, inviting, and slightly imperfect in a charming way.
View: 3/4 top-down perspective.
Requirements:
- ONLY the appliance/tool, no food, no other objects
- Solid flat white background (#FFFFFF), completely uniform, like a blank page
- No shadows cast on background, no gradients, no vignette
- Natural realistic colors for the object
- Visible brushstrokes and subtle paper texture feel
- Ink pen outlines with varying line weight — thicker on edges, thinner on details
- Clean and well-kept appearance, not dirty or rusted
- No text or labels
Output: Square format, hand-drawn watercolor illustration.`
}

// Build tool icon prompt for toolbar buttons
export function buildToolIconPrompt(toolName: string, actionVerb?: string, promptHint?: string): string {
  const subject = promptHint
    ? `${promptHint} ("${toolName}")`
    : `a "${toolName}" kitchen utensil`

  return `A small hand-drawn watercolor sketch of ${subject} for a cooking game toolbar icon.
${actionVerb ? `Used to ${actionVerb} food.` : ''}
Style: Quick, confident ink-and-watercolor sketch like from a vintage cookbook margin illustration. Loose pen linework with a light watercolor wash. Simple, recognizable, charming — the kind of sketch a chef might doodle in their recipe notebook. Not a polished rendering, but an expressive hand-drawn sketch.
View: Slight 3/4 angle, centered.
Requirements:
- ONLY the tool, centered, nothing else
- Solid flat white background (#FFFFFF), completely uniform
- No shadows on background, no gradients
- Simple and instantly recognizable even at small sizes
- Natural realistic colors for the object
- Loose visible pen outlines with light watercolor fill
- Charming and hand-drawn, NOT photorealistic or 3D-rendered
- No text or labels
Output: Square format, 256x256, hand-drawn watercolor sketch.`
}

// Generate tool sprite with Replicate (supports custom size)
export async function generateToolSprite(toolName: string, isHoldable: boolean, actionVerb?: string, type: 'full' | 'icon' = 'full', promptHint?: string): Promise<string> {
  if (!REPLICATE_API_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN not configured')
  }

  const prompt = type === 'icon'
    ? buildToolIconPrompt(toolName, actionVerb, promptHint)
    : buildToolSpritePrompt(toolName, isHoldable, actionVerb, promptHint)

  // Full sprites are larger for table display, icons are small
  const size = type === 'full' && !isHoldable ? 512 : 256

  const createResponse = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MODEL_PRO}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        prompt: prompt,
        aspect_ratio: 'custom',
        width: size,
        height: size,
        output_format: 'png',
        safety_tolerance: 5,
      }
    })
  })

  if (!createResponse.ok) {
    const error = await createResponse.text()
    throw new Error(`Replicate API error: ${error}`)
  }

  const prediction = await createResponse.json()

  let result = prediction
  while (result.status !== 'succeeded' && result.status !== 'failed') {
    await new Promise(resolve => setTimeout(resolve, 500))
    const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
    })
    result = await pollResponse.json()
  }

  if (result.status === 'failed') {
    throw new Error(`Replicate generation failed: ${result.error}`)
  }

  return Array.isArray(result.output) ? result.output[0] : result.output
}

// BiRefNet - better edge preservation (used for Pro tier)
const BIREFNET_VERSION = 'f74986db0355b58403ed20963af156525e2891ea3c2d499bfbfb2a28cd87c5d7'
// rembg - cheaper bg removal (used for Klein tier)
const REMBG_VERSION = 'fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003'

// Resize PNG to target size (BiRefNet can output larger images)
export async function resizePng(buffer: ArrayBuffer, targetSize: number): Promise<Uint8Array> {
  const { Image } = await import('https://deno.land/x/imagescript@1.3.0/mod.ts')
  const img = await Image.decode(new Uint8Array(buffer))
  if (img.width <= targetSize && img.height <= targetSize) {
    return new Uint8Array(buffer)
  }
  img.resize(targetSize, targetSize)
  const encoded = await img.encode()
  return new Uint8Array(encoded.buffer)
}

// Remove background using Replicate's BiRefNet model
export async function removeBackground(imageUrl: string, targetSize = 256): Promise<Uint8Array> {
  const imageResponse = await fetch(imageUrl)
  if (!imageResponse.ok) {
    throw new Error('Failed to fetch generated image')
  }

  const originalBytes = new Uint8Array(await imageResponse.arrayBuffer())

  const bgRemovalResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: BIREFNET_VERSION,
      input: { image: imageUrl }
    })
  })

  if (!bgRemovalResponse.ok) {
    console.error('Background removal request failed, using original')
    return originalBytes
  }

  let result = await bgRemovalResponse.json()
  while (result.status !== 'succeeded' && result.status !== 'failed') {
    await new Promise(resolve => setTimeout(resolve, 500))
    const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
    })
    result = await pollResponse.json()
  }

  if (result.status === 'failed' || !result.output) {
    console.error('Background removal failed, using original')
    return originalBytes
  }

  const transparentResponse = await fetch(result.output)
  const transparentBuffer = await transparentResponse.arrayBuffer()

  // BiRefNet can output larger images, resize back to target
  return resizePng(transparentBuffer, targetSize)
}

// Remove background using rembg (cheaper, used for Klein tier)
export async function removeBackgroundCheap(imageUrl: string, targetSize = 256): Promise<Uint8Array> {
  const imageResponse = await fetch(imageUrl)
  if (!imageResponse.ok) {
    throw new Error('Failed to fetch generated image')
  }

  const originalBytes = new Uint8Array(await imageResponse.arrayBuffer())

  const bgRemovalResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: REMBG_VERSION,
      input: { image: imageUrl }
    })
  })

  if (!bgRemovalResponse.ok) {
    console.error('rembg background removal request failed, using original')
    return resizePng(originalBytes.buffer as ArrayBuffer, targetSize)
  }

  let result = await bgRemovalResponse.json()
  while (result.status !== 'succeeded' && result.status !== 'failed') {
    await new Promise(resolve => setTimeout(resolve, 500))
    const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_API_TOKEN}` }
    })
    result = await pollResponse.json()
  }

  if (result.status === 'failed' || !result.output) {
    console.error('rembg background removal failed, using original')
    return resizePng(originalBytes.buffer as ArrayBuffer, targetSize)
  }

  const transparentResponse = await fetch(result.output)
  const transparentBuffer = await transparentResponse.arrayBuffer()

  return resizePng(transparentBuffer, targetSize)
}

// ---------------------------------------------------------------- Vertex

// Generate sprite bytes with the Gemini image model on Vertex — same
// service-account credentials as the text calls, no Replicate needed.
export async function generateSpriteBytesVertex(prompt: string): Promise<Uint8Array> {
  const ai = vertexAI()
  const response = await ai.models.generateContent({
    model: VERTEX_IMAGE_MODEL,
    config: { responseModalities: ['IMAGE', 'TEXT'] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  })
  const candidate = response.candidates?.[0]
  if (!candidate) throw new Error('Gemini returned no candidates')
  const parts = candidate.content?.parts ?? []
  const imagePart = parts.find((p: any) => p.inlineData?.data)
  if (!imagePart?.inlineData?.data) {
    throw new Error(`Gemini returned no image data (finishReason: ${candidate.finishReason || 'unknown'})`)
  }
  const b64 = imagePart.inlineData.data as string
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Local white-key background removal. The sprite prompt demands a uniform
// #FFFFFF background, so keying near-white pixels (with a feathered ramp for
// anti-aliased edges) gives clean transparency without a segmentation model.
export async function removeWhiteBackground(bytes: Uint8Array, targetSize = 256): Promise<Uint8Array> {
  const { Image } = await import('https://deno.land/x/imagescript@1.3.0/mod.ts')
  const img = await Image.decode(bytes)
  const FULL = 38 // distance-to-white below this → fully transparent
  const FEATHER = 90 // ramp to fully opaque at this distance
  for (let y = 1; y <= img.height; y++) {
    for (let x = 1; x <= img.width; x++) {
      const px = img.getPixelAt(x, y)
      const r = (px >> 24) & 0xff
      const g = (px >> 16) & 0xff
      const b = (px >> 8) & 0xff
      const a = px & 0xff
      const dist = Math.max(255 - r, 255 - g, 255 - b)
      if (dist < FEATHER) {
        const alpha = dist < FULL ? 0 : Math.round(((dist - FULL) / (FEATHER - FULL)) * a)
        img.setPixelAt(x, y, (r << 24) | (g << 16) | (b << 8) | alpha)
      }
    }
  }
  if (img.width > targetSize || img.height > targetSize) img.resize(targetSize, targetSize)
  const encoded = await img.encode()
  return new Uint8Array(encoded.buffer)
}

// Full Vertex pipeline: prompt → gemini image → white-key transparency.
export async function generateSpriteVertex(
  ingredientName: string,
  inputIngredientNames?: string[],
  description?: string,
  promptHint?: string,
  targetSize = 256
): Promise<Uint8Array> {
  const prompt = buildSpritePrompt(ingredientName, inputIngredientNames, description, promptHint)
  const raw = await generateSpriteBytesVertex(prompt)
  return removeWhiteBackground(raw, targetSize)
}

// Generate Klein sprite, remove background with rembg, upload, and save
// Used for first-discovery cheap sprites (tier: 'klein')
export async function generateAndSaveIngredientSpriteKlein(
  supabase: any,
  ingredientId: string,
  name: string,
  inputIngredientNames?: string[],
  description?: string
): Promise<string | null> {
  try {
    console.log(`Klein sprite generation starting for: ${name} (${ingredientId})`)
    let transparentImage: Uint8Array
    if (REPLICATE_API_TOKEN) {
      const rawImageUrl = await generateSpriteKlein(name, inputIngredientNames, description)
      transparentImage = await removeBackgroundCheap(rawImageUrl)
    } else {
      transparentImage = await generateSpriteVertex(name, inputIngredientNames, description)
    }

    const { error: uploadError } = await supabase.storage
      .from('sprites')
      .upload(`ingredients/${ingredientId}.png`, transparentImage, {
        contentType: 'image/png',
        cacheControl: '31536000',
        upsert: true,
      })
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

    const { data: { publicUrl } } = supabase.storage
      .from('sprites')
      .getPublicUrl(`ingredients/${ingredientId}.png`)

    await supabase.from('ingredients').update({ sprite_url: publicUrl, sprite_tier: 'klein' }).eq('id', ingredientId)
    console.log(`Klein sprite generation complete for: ${name}`)
    return publicUrl
  } catch (err) {
    console.error(`Klein sprite generation failed for ${name}:`, err)
    return null
  }
}

// Generate Pro sprite, remove background with BiRefNet, upload, and save
// Single shared implementation used by all automated Pro sprite generation paths
export async function generateAndSaveIngredientSprite(
  supabase: any,
  ingredientId: string,
  name: string,
  inputIngredientNames?: string[],
  description?: string
): Promise<void> {
  try {
    console.log(`Sprite generation starting for: ${name} (${ingredientId})`)
    let transparentImage: Uint8Array
    if (REPLICATE_API_TOKEN) {
      const rawImageUrl = await generateSprite(name, inputIngredientNames, description)
      transparentImage = await removeBackground(rawImageUrl)
    } else {
      transparentImage = await generateSpriteVertex(name, inputIngredientNames, description)
    }

    const { error: uploadError } = await supabase.storage
      .from('sprites')
      .upload(`ingredients/${ingredientId}.png`, transparentImage, {
        contentType: 'image/png',
        cacheControl: '31536000',
        upsert: true,
      })
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

    const { data: { publicUrl } } = supabase.storage
      .from('sprites')
      .getPublicUrl(`ingredients/${ingredientId}.png`)

    await supabase.from('ingredients').update({ sprite_url: publicUrl, sprite_tier: 'pro' }).eq('id', ingredientId)
    console.log(`Pro sprite generation complete for: ${name}`)
  } catch (err) {
    console.error(`Sprite generation failed for ${name}:`, err)
  }
}
