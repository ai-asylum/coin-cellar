-- Tools catalogue, authored fresh for this project (the structure-only clone
-- left the table empty, and the interact edge function 404s on an unknown
-- tool slug). Slugs mirror src/cooking/data/tools.js; no sprite URLs — the
-- client falls back to emoji glyphs until sprites are generated here.
insert into tools (slug, name, emoji, action_verb, mode, max_inputs, is_holdable, unlock_cost, unlock_order)
values
  ('hands',       'Hands',       '🤲', 'Combine', 'combine', 3,  true,  0, 1),
  ('knife',       'Knife',       '🔪', 'Cut',     'single',  1,  true,  0, 2),
  ('whisk',       'Whisk',       '🥄', 'Whisk',   'combine', 3,  true,  0, 3),
  ('grater',      'Grater',      '🧀', 'Grate',   'single',  1,  true,  0, 4),
  ('rolling_pin', 'Rolling Pin', '🪵', 'Roll',    'single',  1,  true,  0, 5),
  ('blender',     'Blender',     '🌀', 'Blend',   'combine', 5,  true,  0, 6),
  ('mortar',      'Mortar',      '🥣', 'Crush',   'combine', 3,  true,  0, 7),
  ('peeler',      'Peeler',      '🥕', 'Peel',    'single',  1,  true,  0, 8),
  ('stove',       'Stove',       '🍳', 'Fry',     'combine', 5,  false, 0, 9),
  ('pot',         'Pot',         '🍲', 'Boil',    'combine', 5,  false, 0, 10),
  ('oven',        'Oven',        '🔥', 'Roast',   'combine', 5,  false, 0, 11),
  ('freezer',     'Freezer',     '❄️', 'Freeze',  'single',  1,  false, 0, 12),
  ('grill',       'Grill',       '♨️', 'Grill',   'combine', 3,  false, 0, 13),
  ('deep_fryer',  'Deep Fryer',  '🍟', 'Deep-fry','combine', 4,  false, 0, 14),
  ('smoker',      'Smoker',      '💨', 'Smoke',   'combine', 3,  false, 0, 15),
  ('barrel',      'Barrel',      '🛢️', 'Ferment', 'single',  1,  false, 0, 16),
  -- plating vessels ride in the same table so the client can fetch their art
  ('plate',       'Plate',       '🍽️', 'Plate',   'combine', 10, false, 0, 17),
  ('bowl',        'Bowl',        '🥣', 'Plate',   'combine', 6,  false, 0, 18),
  ('cup',         'Cup',         '🥤', 'Plate',   'combine', 3,  false, 0, 19)
on conflict (slug) do update set
  name = excluded.name,
  emoji = excluded.emoji,
  action_verb = excluded.action_verb,
  mode = excluded.mode,
  max_inputs = excluded.max_inputs,
  is_holdable = excluded.is_holdable;
