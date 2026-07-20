// The town's named residents. Every Kenney "Blocky" skin (character-b … r —
// the hero keeps "a") is a distinct person with a name, a personality voice,
// and their own lines of small talk. The shop's shoppers and the street's
// passers-by are drawn from this roster so a face on screen is always the same
// townsperson, never an anonymous body — and the allocator (see shop.js) makes
// sure no two people on screen at once wear the same skin.
//
// Every resident has their OWN personality voice — no two townsfolk read alike.
// The classic cozy-village archetypes (peppy, lazy, cranky, snooty, jock, normal,
// smug, sisterly) seed the first eight; the rest branch off into their own
// temperaments (dreamer, bookish, foodie, boastful, inventor, pompous, gossip,
// zen, outdoorsy). The flavour is the inspiration; every line is fresh for Coin
// Cellar.

// One distinct personality voice per resident — no two townsfolk read alike.
// The first eight are the classic cozy-village archetypes; the rest give each
// remaining face its own temperament so you never meet the same person twice.
// `mood` maps to a face icon (see core/icons.js) so the admin panel and any
// emote can show the temperament at a glance (a handful of voices share a face
// — it's a coarse cue; the `name` and `blurb` tell them apart).
// `archetype` is the townsperson's "shopper characteristic" — the customer
// archetype (see ARCHETYPES in shop-data.js) they always shop as. It's fixed by
// temperament so the same face haggles the same way every visit: eager Collectors
// splurge, the Wealthy chase finery, Cheapskates pinch coins, and the steady
// Regular crowd shop even-handedly.
//
// `taste` is what *kind* of thing tempts them (the archetype only sets how much
// they'll pay). `kinds` multiplies an item's appeal by its kind (see itemKind
// in items.js: food / weapon / gear / treasure) — >1 draws them to it, <1 turns
// their nose up. `tierLean` biases them toward cheap-and-cheerful (negative) or
// rare-and-costly (positive) goods on top of that. A shopper's favourite is the
// item that scores highest across these, so who buys what now reads off their
// personality: the Lazy go for snacks, the Jocks for heavy weapons, the Snooty
// for glittering treasure.
export const PERSONALITIES = {
  peppy: {
    name: "Peppy",
    mood: "faceStar",
    archetype: "Collector",
    // starry-eyed magpies — everything's exciting, sparkly treasure most of all
    taste: { kinds: { food: 1.15, weapon: 1.0, gear: 1.1, treasure: 1.4 }, tierLean: 0.3 },
    blurb: "Bubbly, breathless and starry-eyed. Everything is the best thing ever.",
  },
  lazy: {
    name: "Lazy",
    mood: "faceNeutral",
    archetype: "Cheapskate",
    // snack-minded and thrifty — a bite to eat beats anything they'd have to carry
    taste: { kinds: { food: 1.8, weapon: 0.7, gear: 0.8, treasure: 0.9 }, tierLean: -0.5 },
    blurb: "Easygoing and snack-minded. Would rather nap than hurry anywhere.",
  },
  cranky: {
    name: "Cranky",
    mood: "faceAngry",
    archetype: "Cheapskate",
    // practical old grumps — useful kit over frippery, and nothing overpriced
    taste: { kinds: { food: 1.0, weapon: 1.15, gear: 1.3, treasure: 0.6 }, tierLean: -0.6 },
    blurb: "Gruff and grumbling on the outside, quietly rooting for you underneath.",
  },
  snooty: {
    name: "Snooty",
    mood: "faceMonocle",
    archetype: "Wealthy",
    // only the finest — rare treasure and fine trinkets; food is beneath them
    taste: { kinds: { food: 0.5, weapon: 0.75, gear: 1.2, treasure: 1.7 }, tierLean: 1.0 },
    blurb: "Haughty and image-conscious. Only the finest will do, darling.",
  },
  jock: {
    name: "Jock",
    mood: "faceSmile",
    archetype: "Regular",
    // gains-focused — big weapons and gear to haul, plus protein
    taste: { kinds: { food: 1.1, weapon: 1.7, gear: 1.4, treasure: 0.7 }, tierLean: 0.2 },
    blurb: "All energy and gains. Turns every errand into a workout.",
  },
  normal: {
    name: "Normal",
    mood: "faceHappy",
    archetype: "Regular",
    // level-headed homebodies — a soft spot for homely food, otherwise even-handed
    taste: { kinds: { food: 1.3, weapon: 0.95, gear: 1.05, treasure: 1.0 }, tierLean: 0.0 },
    blurb: "Warm, level-headed and neighbourly. The heart of the town.",
  },
  smug: {
    name: "Smug",
    mood: "faceRoll",
    archetype: "Wealthy",
    // image is everything — luxury treasure and status trinkets to be admired with
    taste: { kinds: { food: 0.7, weapon: 0.9, gear: 1.3, treasure: 1.6 }, tierLean: 0.8 },
    blurb: "Smooth, polished and endlessly charming — mostly to themselves.",
  },
  sisterly: {
    name: "Sisterly",
    mood: "faceHuff",
    archetype: "Regular",
    // caretakers — food to feed folk and sturdy gear that'll last, no fuss
    taste: { kinds: { food: 1.4, weapon: 1.0, gear: 1.15, treasure: 0.9 }, tierLean: -0.1 },
    blurb: "Tough-talking big-sibling type who looks out for everyone.",
  },
  dreamer: {
    name: "Dreamer",
    mood: "faceThink",
    archetype: "Collector",
    // head in the clouds — collects pretty little wonders and calls it all magic
    taste: { kinds: { food: 1.1, weapon: 0.85, gear: 1.0, treasure: 1.4 }, tierLean: 0.3 },
    blurb: "Soft-spoken and starry-headed, forever chasing little wonders.",
  },
  bookish: {
    name: "Bookish",
    mood: "faceMonocle",
    archetype: "Regular",
    // a tidy mind — sturdy, well-made, useful things; never without a fact
    taste: { kinds: { food: 1.0, weapon: 0.95, gear: 1.35, treasure: 0.9 }, tierLean: 0.1 },
    blurb: "Precise, curious and never short of a fact to share.",
  },
  foodie: {
    name: "Foodie",
    mood: "faceHappy",
    archetype: "Regular",
    // lives to eat — the finer the fare the better; everything else is just fuel
    taste: { kinds: { food: 1.9, weapon: 0.7, gear: 0.85, treasure: 0.8 }, tierLean: 0.0 },
    blurb: "Warm and greedy in the nicest way — judges the town by its baking.",
  },
  boastful: {
    name: "Boastful",
    mood: "faceSmile",
    archetype: "Regular",
    // every buy is a trophy — big weapons and loot worth bragging about
    taste: { kinds: { food: 1.0, weapon: 1.6, gear: 1.3, treasure: 1.1 }, tierLean: 0.4 },
    blurb: "Loud, competitive and always mid-way through a tall tale.",
  },
  inventor: {
    name: "Inventor",
    mood: "faceConfused",
    archetype: "Regular",
    // a magpie for mechanisms — gadgets, gear and anything with moving parts
    taste: { kinds: { food: 0.9, weapon: 1.1, gear: 1.6, treasure: 1.0 }, tierLean: 0.2 },
    blurb: "A scattered tinkerer with a half-finished contraption in each pocket.",
  },
  pompous: {
    name: "Pompous",
    mood: "faceRoll",
    archetype: "Wealthy",
    // grandeur befitting the office — showy treasure to trumpet civic splendour
    taste: { kinds: { food: 0.8, weapon: 0.9, gear: 1.2, treasure: 1.6 }, tierLean: 0.9 },
    blurb: "Self-important and endlessly campaigning — for himself, mostly.",
  },
  gossip: {
    name: "Gossip",
    mood: "faceHuff",
    archetype: "Regular",
    // shops to be seen and to talk — tea, treats and trinkets worth remarking on
    taste: { kinds: { food: 1.3, weapon: 0.9, gear: 1.0, treasure: 1.3 }, tierLean: 0.1 },
    blurb: "Nosy, chatty and three secrets deep into everyone's business.",
  },
  zen: {
    name: "Zen",
    mood: "faceNeutral",
    archetype: "Cheapskate",
    // wants little, needs less — simple food, nothing to weigh the soul down
    taste: { kinds: { food: 1.4, weapon: 0.85, gear: 0.95, treasure: 0.85 }, tierLean: -0.3 },
    blurb: "Unhurried and unbothered — takes the world one slow breath at a time.",
  },
  outdoorsy: {
    name: "Outdoorsy",
    mood: "faceSmile",
    archetype: "Regular",
    // a forager's eye — hearty food and rugged kit for a life spent outside
    taste: { kinds: { food: 1.35, weapon: 1.1, gear: 1.3, treasure: 0.8 }, tierLean: -0.1 },
    blurb: "Sun-weathered and cheerful, happiest knee-deep in the fields.",
  },
};

// The four times of day townsfolk chatter is bucketed into. Boundaries line up
// loosely with the street's day/night clock (see shop.js DAY_CLOCK): the town
// wakes around dawn, bustles at midday, mellows at the golden hour, and turns
// in after dark.
export const TIMES_OF_DAY = ["morning", "afternoon", "evening", "night"];

// Bucket a 0–24 wall-clock hour into one of TIMES_OF_DAY.
export function timeOfDay(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

// The five small-talk lines an NPC offers at the given hour. Falls back
// gracefully if a bucket is ever missing (or if `lines` is still a flat array).
export function npcLinesFor(npc, hour) {
  const l = npc?.lines;
  if (!l) return [];
  if (Array.isArray(l)) return l;
  return l[timeOfDay(hour)] || l.morning || Object.values(l)[0] || [];
}

// A one-off introduction the very first time you ever chat with a townsperson.
// The player is the newcomer heir who's just taken over the old shop, so each
// resident clocks the new face, reacts in their own voice, and gives their
// name — after that first hello they fall back to ordinary small talk (see
// npcLinesFor). Keyed by npc id; two bubbles each, in the same house style as
// the small talk (one idea per line). An id without an entry simply skips
// straight to small talk.
export const INTROS = {
  pip: [
    "Ooh! Are YOU the one who took over the old shop?! Eee, I've SO been wanting to meet you!",
    "I'm Pip! Eee, we're gonna be the BEST of friends, I just KNOW it!",
  ],
  barrow: [
    "Hmph. New face. You'd be the one who took on the old shop, then.",
    "Barrow. That's my name, not that you asked. ...Welcome, I suppose.",
  ],
  tansy: [
    "Oh, hello there, dear! You must be the one who's taken on the old shop.",
    "I'm Tansy. It's ever so lovely to have you in town — truly it is.",
  ],
  nib: [
    "New to town? I thought as much — I'd have you on file otherwise.",
    "Nib. I kept the ledgers here for years. The counter's yours now.",
  ],
  rocco: [
    "YO! You're the one runnin' the old shop now, huh? Respect, champ!",
    "Name's Rocco, champ! Stick with me — we'll get those gains. Er, sales!",
  ],
  marlowe: [
    "A stranger — and here I thought I'd met everyone worth meeting.",
    "Marlowe. Charmed — you especially, I'd imagine. Welcome to town.",
  ],
  clementine: [
    "You're new. I can always tell. The shoes rather give it away, darling.",
    "Clementine. Do try to raise the tone now that you've arrived.",
  ],
  sunny: [
    "Oh... it's you. You drifted in like the old shop had been waiting for you.",
    "I'm Sunny. The town feels a little brighter with you in it, I think.",
  ],
  ozzie: [
    "Oh, hey... you're the one who took the old shop? Sounds like a lotta effort.",
    "I'm Ozzie. Welcome, I guess. Don't make me get up to shake on it.",
  ],
  delphine: [
    "Well, look at you — just blown into town! Running the old shop now, are you, kiddo?",
    "I'm Delphine. Anybody gives you grief, you come straight to me, hear?",
  ],
  gus: [
    "Ah, a newcomer. The town makes room for whoever wanders in. Welcome, friend.",
    "I'm Gus. No rush to settle in. The place'll fit you soon enough.",
  ],
  vera: [
    "Oh, it's YOU! The whole street's been talking of nothing else, dear.",
    "I'm Vera. I know everything worth knowing — do come to me first.",
  ],
  bruno: [
    "New in town, eh? Took over the old place? Brave. I like brave. I'm brave too.",
    "Name's Bruno. Ask anyone — best-known man in town. You're welcome to it.",
  ],
  hazel: [
    "A new mouth to feed in town! You've taken charge of the old shop, have you, dear?",
    "I'm Hazel. First things first — you look like you need feeding up.",
  ],
  silas: [
    "You're the one with the old shop now — oh, the things we could rig up in there—",
    "I'm Silas. Tinkerer, mostly. Come find me if anything wants improving.",
  ],
  mayor: [
    "Ah! The new arrival! You've claimed the old shop — splendid for MY township!",
    "I am the Mayor. Your prosperity reflects on me, naturally. Welcome!",
  ],
  maple: [
    "Fresh boots on our streets, eh! Keeping the old shop these days, are you? Good on ya.",
    "I'm Maple. Ever need out of that stuffy shop, I know all the best trails.",
  ],
};

// The one-off introduction lines for a townsperson's first-ever chat, or an
// empty array if they have none (they'll just open with small talk instead).
export function npcIntroLines(npc) {
  return (npc?.id && INTROS[npc.id]) || [];
}

// The roster. `variant` is the Kenney skin (must be unique per person). `reserved`
// marks the two townsfolk with scripted cameos (the Mayor and the Clerk) so the
// ambient crowd allocator leaves their skins free for those set-pieces. `lines`
// carries five small-talk bubbles per time of day (see TIMES_OF_DAY) so a face
// you meet at dawn greets you differently than the same face after dark.
export const NPCS = [
  {
    id: "pip", name: "Pip", variant: "b", personality: "peppy",
    buyLines: {
      boughtLoved: [
        "I got the {item}! The {item}!! Best buy of my WHOLE life, hee!",
        "Eeee, I bought a {item} and I already love it more than words!",
      ],
      boughtWhim: [
        "I didn't NEED the {item}, but my hand just grabbed it, hee!",
        "Oops, bought a {item}! No regrets. Okay, a tiny one. No, none!",
      ],
      passedPricey: [
        "I wanted that {item} SO bad, but eee, my coins said no!",
        "The {item} was calling my name! I was strong though. Barely!",
      ],
      passedMeh: [
        "Nothing jumped out at me today, can you believe it?!",
        "I looked at EVERYTHING and my heart didn't go boing. Weird!",
      ],
    },
    wishLines: [
      "Ooh, if something all sparkly and precious comes in, save it for ME, 'kay?!",
      "I go WEAK for shiny treasure — gems, crowns, glittery bits. Bring 'em ALL, hee!",
    ],
    lines: {
      morning: [
        "Morning morning MORNING! Best part of the day, obviously!",
        "I already had juice AND a cookie. Don't tell anyone, hee hee!",
        "Ooh, what are we selling today?! I wanna see everything!",
        "The sun's out and so am I! Coincidence? I think NOT!",
        "Okay byeee, gotta go be adorable somewhere else!",
      ],
      afternoon: [
        "Heehee, hi again! The day's just zooming by, huh?!",
        "I've said hi to like a MILLION people already. Give or take!",
        "Is it snack o'clock? It's always snack o'clock for me!",
        "Your shop's the busiest spot in town, I bet! So cool!",
        "Catch ya later! Don't have TOO much fun without me!",
      ],
      evening: [
        "Ooh, the sky's going all pink! Pretty pretty pretty!",
        "Golden hour makes everything sparkle. Including me!",
        "I did SO much today. I'm basically a hero, right?!",
        "One more lap around town before dark, wheee!",
        "Nighty-night soon! Dream about something pink for me, 'kay?!",
      ],
      night: [
        "Psst! It's late but I'm WIDE awake. Can you tell?!",
        "The stars are out! I counted nine. Then I got bored, hee!",
        "Shhh, everyone's sleepy but us. We're the cool ones!",
        "I should be in bed. But the night's just so twinkly!",
        "Okay okay, bedtime! Sweet dreams, you big superstar!",
      ],
    },
  },
  {
    id: "barrow", name: "Barrow", variant: "c", personality: "cranky",
    buyLines: {
      boughtLoved: [
        "Got myself a {item}. Don't tell anyone I'm pleased. Hmph.",
        "That {item}'s a proper bit of kit. Worth the coin, not that I'd say so.",
      ],
      boughtWhim: [
        "Bought a {item}. Don't rightly know why. Momentary weakness.",
        "Walked out with a {item}. Bah. Impulse. Won't happen again.",
      ],
      passedPricey: [
        "That {item} caught my eye, then I saw the price. Robbery.",
        "Wanted the {item}. Not at that price, I didn't. Hmph.",
      ],
      passedMeh: [
        "Nothing worth my coin today. Same as most days.",
        "Bah. Looked, saw nothing, left. Story of my life.",
      ],
    },
    wishLines: [
      "Stock honest kit, not glittery junk. Lanterns, boots, a sturdy shield. That's sense.",
      "I want gear that earns its keep — and none of it priced like it's made of gold. Hmph.",
    ],
    lines: {
      morning: [
        "Hmph. Up at this hour? Least you've got some sense.",
        "Coffee's the only thing worth trusting before noon.",
        "Back in my day, morning meant work. Not lollygagging.",
        "Don't expect me to be chipper. I don't do chipper.",
        "Go on, open up. Daylight's wasting.",
      ],
      afternoon: [
        "Bah. Middle of the day and the town's still half-asleep.",
        "Your prices are robbery. ...Wrap that one up anyway.",
        "Kids these days. No respect for a good honest nap.",
        "That cave's swallowed better folk than you. Mind yourself.",
        "Enough chit-chat. I've got standing-around to do.",
      ],
      evening: [
        "Sun's going down. Finally, something I can agree with.",
        "Evenings were quieter when I was young. Everything was.",
        "You did a day's work. I'll give you that much. Hmph.",
        "My knees say it's rain tomorrow. My knees are never wrong.",
        "Off home before dark. Don't you dawdle out here.",
      ],
      night: [
        "Still open? At this hour? You're daft, kid.",
        "Can't sleep. Never could. Don't much like it, either.",
        "Quiet out. Suits an old grump like me just fine.",
        "Lock up tight. Odd things wander a town after dark.",
        "Bah. Get some rest. You'll need it tomorrow.",
      ],
    },
  },
  {
    id: "tansy", name: "Tansy", variant: "d", personality: "normal",
    buyLines: {
      boughtLoved: [
        "I picked up a lovely {item}, dear. Just what I was after!",
        "That {item}'s a little treasure. I'm ever so glad I got it.",
      ],
      boughtWhim: [
        "I treated myself to a {item}. A bit silly, but why not, dear!",
        "Bought a {item} on a whim. Don't tell my sensible side.",
      ],
      passedPricey: [
        "I did fancy that {item}, but I thought better of it today.",
        "That {item} was tempting, dear. Maybe another day.",
      ],
      passedMeh: [
        "Nothing quite caught me today, but it was nice to browse.",
        "I had a good look round, dear, but nothing came home with me.",
      ],
    },
    wishLines: [
      "A bit of fresh bread or something for the pot, that's what warms a house, dear.",
      "Keep some good honest food on the shelf and I'll be by ever so often, promise.",
    ],
    lines: {
      morning: [
        "Good morning! Isn't it a lovely one? Fresh and bright.",
        "I've been baking since dawn. The whole street smells grand.",
        "Nice to see the shop open early. Good habits, that.",
        "Careful in that cave today, won't you? Come back safe.",
        "Have a wonderful morning, dear. See you soon!",
      ],
      afternoon: [
        "Afternoon! The town's lively today, isn't it nice?",
        "I told my neighbours to stop by. They promised they would.",
        "You look like you've been working hard. Good for you.",
        "Don't forget to eat something, dear. Mustn't skip lunch.",
        "I'll let you get back to it. Take care now!",
      ],
      evening: [
        "Evening! The sunset's painting everything gold, look.",
        "Days end so gently here. It's my favourite part.",
        "You did well today. You can feel the town warming up.",
        "I'm off to put the kettle on. You're welcome to a cup.",
        "Sleep well when you get there, dear. Goodnight.",
      ],
      night: [
        "Still up? So am I. The quiet's rather nice, isn't it?",
        "The stars are lovely tonight. Worth staying up for.",
        "Don't work yourself too late. Rest matters just as much.",
        "I'll leave a light on, in case someone wanders home late.",
        "Goodnight, dear. Mind how you go in the dark.",
      ],
    },
  },
  {
    id: "nib", name: "Nib the Clerk", variant: "e", personality: "bookish", reserved: true,
    buyLines: {
      boughtLoved: [
        "Acquired a {item}. Well-made, correctly priced — I checked twice, naturally.",
        "Got a {item}. A sound purchase. I've the ledger entry to prove it.",
      ],
      boughtWhim: [
        "Bought a {item}. Undocumented impulse. Rare, for me. I'll note it later.",
        "Walked out with a {item}. Filed under 'inexplicable'. It happens, apparently.",
      ],
      passedPricey: [
        "Eyed that {item}, then ran the sums. The sums, as ever, said wait.",
        "The {item} tempted me. But a fair price has a shape, and that wasn't it.",
      ],
      passedMeh: [
        "Nothing met the criteria today. I do keep criteria, you know.",
        "Browsed, catalogued, bought nothing. A tidy sort of visit.",
      ],
    },
    wishLines: [
      "I favour the well-made and the sensible — sturdy gear, correctly priced. It endures.",
      "Stock things built to last, not to dazzle. A sound tool outlives a shiny one. Fact.",
    ],
    lines: {
      morning: [
        "Morning. Did you know a good ledger outlasts three roofs? It's true.",
        "The counter's yours now, but I still balance it in my head. Force of habit.",
        "Every item has a proper place. Yours are nearly all in theirs. Nearly.",
        "I logged the sunrise at four minutes past five. For the records.",
        "Do ask if you're stuck. I've a fact for most things, and some for the rest.",
      ],
      afternoon: [
        "Afternoon. Thirty-one customers so far. I count them. Someone should.",
        "A curious thing about that cave: the deeper floors run older than the town.",
        "Your pricing's improved. I've been keeping a discreet tally. It's up.",
        "A slow spell is just time to reorganise. I find it deeply restful.",
        "Back to it. If a figure won't add up, bring it to me. They rarely win.",
      ],
      evening: [
        "Evening. Interesting fact: dusk light makes coins easier to miscount. Careful.",
        "I've read that a well-kept shop sleeps easier. Yours is getting there.",
        "You closed a fair number of sales today. I noticed. I always notice.",
        "Reconcile your till before you lock up. A penny lost now is an hour tomorrow.",
        "Goodnight. I'll be reading. There's a splendid book on drainage law.",
      ],
      night: [
        "Still at it? Records show late nights and long mornings rarely mix. Mind that.",
        "The deep floors get restless after dark — documented, that. Stay sharp.",
        "Quiet suits a thinking sort of person. And I am, chiefly, a thinking sort.",
        "I could tell you the shop's exact takings today. I shan't. But I could.",
        "Goodnight. Sleep's the one ledger that always comes due. Settle it.",
      ],
    },
  },
  {
    id: "rocco", name: "Rocco", variant: "f", personality: "jock",
    buyLines: {
      boughtLoved: [
        "Grabbed a {item}! Perfect for the grind, champ! LET'S GO!",
        "Got the {item}! Feel the GAINS already, no joke!",
      ],
      boughtWhim: [
        "Bought a {item}. Didn't plan to, but hey, spontaneity's a muscle too!",
        "Snagged a {item} outta nowhere. Impulse rep, ha!",
      ],
      passedPricey: [
        "That {item} looked awesome, but my wallet needed a rest day.",
        "Wanted the {item}, champ, but I'm savin' up for the big lift!",
      ],
      passedMeh: [
        "Nothin' got my heart rate up today. Rare, I know!",
        "Browsed the whole floor, no burn. Maybe tomorrow, champ!",
      ],
    },
    wishLines: [
      "Bring in the HEAVY stuff, champ — big blades, solid armour. Gains you can carry!",
      "Weapons and gear with some WEIGHT to 'em, that's my aisle. Heavier the better!",
    ],
    lines: {
      morning: [
        "YO! Morning workout DONE. Now I'm ready to shop!",
        "Rise and grind, champ! Mostly grind! Ha!",
        "You stretch yet? Cave diving's a full-body sport, no joke!",
        "Fresh sunrise, fresh gains. Best combo there is!",
        "Later! Go crush the day like it owes you push-ups!",
      ],
      afternoon: [
        "Midday pump, let's GO! You lifting any loot today?",
        "That dive counts as cardio, easy. Respect, champ!",
        "I ran here. I ran everywhere. I'm ALWAYS running!",
        "Sell me something heavy. I need the carry practice!",
        "Stay hydrated out there! Water's the real MVP!",
      ],
      evening: [
        "Evening burn's the best burn! One more set, then chill!",
        "Sun's setting and so am I — into a big ol' dinner! Ha!",
        "You earned your protein today, champ. Go get it!",
        "Cool-down time. Even legends gotta stretch it out!",
        "Later! Sleep's when the gains happen, don't skip it!",
      ],
      night: [
        "Still up? Respect the hustle — but rest is gains too!",
        "Night runs hit different. Just me and the stars, whoo!",
        "No late snacks... okay, maybe ONE. For the gains!",
        "Big day tomorrow means big sleep tonight, champ!",
        "Night! Dream about deadlifts or somethin', ha!",
      ],
    },
  },
  {
    id: "marlowe", name: "Marlowe", variant: "g", personality: "smug",
    buyLines: {
      boughtLoved: [
        "I acquired a {item}. It suits me, naturally. Everything does.",
        "The {item} is mine now. It was practically begging to be seen with me.",
      ],
      boughtWhim: [
        "I bought a {item} on a whim. My whims have exquisite taste.",
        "A {item}? Impulse. Though even my impulses are rather refined.",
      ],
      passedPricey: [
        "That {item} was tempting, but I don't chase — things come to me.",
        "I admired the {item}. Admiring is often enough, don't you find?",
      ],
      passedMeh: [
        "Nothing quite lived up to me today. A common problem.",
        "I browsed, I dazzled, I bought nothing. The shop's loss.",
      ],
    },
    wishLines: [
      "I've an eye for the finer things — treasure, trinkets, anything that flatters me.",
      "Stock something luxurious and I'll be back. Beauty deserves beautiful company.",
    ],
    lines: {
      morning: [
        "Good morning, and what a fetching one — much like myself.",
        "I rose with the sun. It insisted on seeing me, naturally.",
        "A little charm before breakfast keeps the day interesting.",
        "You've caught me at my freshest. Lucky you, truly.",
        "Do carry on. I've mornings to grace elsewhere.",
      ],
      afternoon: [
        "Ah, midday. My best lighting, if I do say so.",
        "Between us, I always know a good deal when I smile at one.",
        "The town does buzz more when I'm about. Coincidence?",
        "You have impeccable timing — I adore being admired.",
        "Until later. Try not to miss me too dreadfully.",
      ],
      evening: [
        "What a sunset. Almost as striking as present company.",
        "Golden hour was practically invented for a face like mine.",
        "Evenings are for mystery. And I am terribly mysterious.",
        "A day's charm behind us. I do exhaust myself, dashingly.",
        "Farewell for now. Dream of someone worthwhile — me.",
      ],
      night: [
        "Out late? A person of mystery keeps unusual hours.",
        "Moonlight suits me. Everything suits me, really.",
        "The quiet's rather flattering. No one to upstage me.",
        "Stars are lovely, but they've nothing on my smile.",
        "Goodnight, friend. Do think of me fondly. Everyone does.",
      ],
    },
  },
  {
    id: "clementine", name: "Clementine", variant: "h", personality: "snooty",
    buyLines: {
      boughtLoved: [
        "I secured the {item}. Finally, something with a shred of taste.",
        "The {item} is acceptable. High praise, from me, darling.",
      ],
      boughtWhim: [
        "I bought a {item}. A lapse. Even I have my careless moments.",
        "A {item}? An impulse purchase. Do not make me regret it.",
      ],
      passedPricey: [
        "The {item} was almost worthy. Almost. I'll wait for better.",
        "I considered the {item}, but one mustn't reward the mediocre.",
      ],
      passedMeh: [
        "Nothing here met my standards today. Quelle surprise.",
        "I saw nothing worth my coin. Do try harder, darling.",
      ],
    },
    wishLines: [
      "I buy nothing but the rarest treasure, darling. Stock accordingly, if you're able.",
      "The finest gems, the costliest trinkets — that earns my coin. Nothing less will.",
    ],
    lines: {
      morning: [
        "Morning. This town could use a touch of taste before noon.",
        "I take my morning air where the riffraff hasn't gathered.",
        "That's what you wear to open a shop? How... rustic.",
        "Do let me know when you stock anything worth my time.",
        "Ta-ta. I've refinement to attend to elsewhere.",
      ],
      afternoon: [
        "Afternoon. I suppose the light's tolerable today.",
        "I only buy the very finest. You've been warned.",
        "The dungeon? Ugh, all that dust. I'll wait up here.",
        "A proper vitrine at last. About time someone had standards.",
        "Do keep the shelves presentable. For my sake.",
      ],
      evening: [
        "Evening. The sunset's almost tasteful. I'll allow it.",
        "One dresses for dusk, darling. Clearly you didn't.",
        "I heard the last owner had no eye. A tragedy, really.",
        "If it isn't rare, it isn't worth my coin. Remember that.",
        "I'm off to somewhere with better company. Ta.",
      ],
      night: [
        "Out at this hour? How positively bohemian of you.",
        "The stars, at least, know how to sparkle properly.",
        "Night air ruins one's complexion. I shan't linger.",
        "Do lock up. Common folk get such ideas after dark.",
        "Goodnight. Dream of something exquisite. Do try.",
      ],
    },
  },
  {
    id: "sunny", name: "Sunny", variant: "i", personality: "dreamer",
    buyLines: {
      boughtLoved: [
        "I brought home a {item}. It hums, don't you think? Little things do.",
        "A {item} came to me today. Some things just want to be found, I feel.",
      ],
      boughtWhim: [
        "I drifted off and woke with a {item} in my hands. The day decided, not me.",
        "A {item} followed me home like a stray daydream. I couldn't say no.",
      ],
      passedPricey: [
        "The {item} was lovely, but some wonders are for admiring, not keeping.",
        "I held the {item} a while, then let it stay. It belonged to the light there.",
      ],
      passedMeh: [
        "Nothing whispered to me today. That's alright. Tomorrow might.",
        "I wandered and dreamed and bought nothing at all. A soft sort of day.",
      ],
    },
    wishLines: [
      "If something pretty and quietly magical comes in — a crystal, a star — set it by for me?",
      "I do love little wonders. Anything that glimmers or hums, I could gaze at for hours.",
    ],
    lines: {
      morning: [
        "Morning... or is it? The light's the colour of honey, so I forgive it.",
        "I dreamed of a floating shop last night. Yours, maybe. It had wings.",
        "Do you ever watch the dust drift in a sunbeam? I could, all day.",
        "The town's still half-asleep. So am I, mostly. It's nice here.",
        "I'll wander off now. The clouds are doing something wonderful.",
      ],
      afternoon: [
        "Oh, hello. I was somewhere else for a moment. Somewhere gentler.",
        "Your shelves look like a little constellation. All those tiny glimmers.",
        "I forgot where I was going. So now I'm just... going. Lovely, really.",
        "If wishes were coins, I'd be terribly rich. And terribly generous.",
        "Bye for now. I've a daydream half-finished I ought to get back to.",
      ],
      evening: [
        "Look at the sky. Someone's spilled peach and rose all over it.",
        "Dusk makes everything feel like the end of a good story.",
        "I collected three pretty pebbles today. Small treasures count too.",
        "The lamps are waking up. They look like fallen stars, don't they?",
        "Goodnight soon. Dream of somewhere soft, and I'll meet you there.",
      ],
      night: [
        "The stars are so loud tonight. Quietly loud, if that makes sense.",
        "I can't sleep when the moon's this full. It feels rude to miss it.",
        "Everything's hushed and silver. My favourite kind of hour.",
        "I'm chasing a thought I had at breakfast. Nearly caught it.",
        "Goodnight. Leave a little room in your dreams for wonder, hm?",
      ],
    },
  },
  {
    id: "ozzie", name: "Ozzie", variant: "j", personality: "lazy",
    buyLines: {
      boughtLoved: [
        "Got a {item}. Worth wakin' up for, honestly. Rare praise.",
        "Mmn, bought a {item}. Snack-tier purchase. Very satisfied.",
      ],
      boughtWhim: [
        "Bought a {item}. Dunno why. Seemed like less effort than not to.",
        "A {item} just kinda ended up in my hands. Too tired to say no.",
      ],
      passedPricey: [
        "Sorta wanted that {item}, but reachin' for my coins? Effort.",
        "The {item} looked alright. Not 'get-up-and-pay' alright, though.",
      ],
      passedMeh: [
        "Nothin' grabbed me. Then again, I wasn't grabbin' hard.",
        "Looked around, got sleepy, left. Standard trip, really.",
      ],
    },
    wishLines: [
      "Just keep snacks around, honestly. Cheap eats. Somethin' I don't gotta work for. Mmn.",
      "Food's the only thing worth reachin' for. Nothin' fancy — nothin' pricey, either.",
    ],
    lines: {
      morning: [
        "Mmn... mornin'. Is it though? Feels too early for that.",
        "Five more minutes. That's my whole morning plan, honestly.",
        "You're up already? Wild. I respect it from a distance.",
        "Got any pastries in? Mornings need pastries. It's science.",
        "Welp. Gonna go find a warm spot. Later, maybe.",
      ],
      afternoon: [
        "Oh, hey... didn't see ya. Mid-daydream about snacks.",
        "Runnin' a shop sounds like a lotta standing. You okay?",
        "Afternoons are for sittin'. I'm very good at afternoons.",
        "If the cave had a nap corner, I'd totally go delving.",
        "Anyway. Back to my very busy schedule of nothing.",
      ],
      evening: [
        "Evenin'. Best part of the day. Everything slows down, nice.",
        "Sunset's doin' its thing. I'm just gonna watch, don't mind me.",
        "You worked all day? Just hearing it makes me tired.",
        "Dinner soon, then couch. That's the dream, right there.",
        "Alright... gonna go be horizontal somewhere. Later.",
      ],
      night: [
        "Zzz— huh? Oh. Night. Wait, why are YOU still up?",
        "Nights are so cozy. Made for sleepin'. So I should go.",
        "Too tired to walk home. Might just nap right here.",
        "Wake me if any snacks show up. Otherwise, don't.",
        "Welp. Bed's callin' and I'm answerin'. G'night.",
      ],
    },
  },
  {
    id: "delphine", name: "Delphine", variant: "k", personality: "sisterly",
    buyLines: {
      boughtLoved: [
        "Snagged a {item}, hon. Just the thing — big sib knows quality.",
        "Got a {item}. Real pleased with it, kiddo. You stock good stuff.",
      ],
      boughtWhim: [
        "Treated myself to a {item}. Don't usually, but eh, why not.",
        "Bought a {item} on a whim. Even I'm allowed a little something.",
      ],
      passedPricey: [
        "Had my eye on that {item}, kiddo, but I held off this time.",
        "The {item} tempted me, hon. I'll come back for it, maybe.",
      ],
      passedMeh: [
        "Nothin' called to me today, but your shop's lookin' good.",
        "Browsed a while, bought nothin'. No harm in lookin', kiddo.",
      ],
    },
    wishLines: [
      "Keep some good food in, kiddo, and sturdy gear too. A body's gotta eat AND stay safe.",
      "Hearty meals and kit that won't let folk down — that's what I come lookin' for, hon.",
    ],
    lines: {
      morning: [
        "Mornin', kiddo! Up with the sun, good on ya.",
        "You eat breakfast? Don't you dare say no to me.",
        "Fresh day, clean slate. Go make somethin' of it, hon.",
        "Don't go into that cave on an empty stomach, hear me?",
        "Alright, off you go. Chin up, champ!",
      ],
      afternoon: [
        "Hey, hon. Busy day? You look like you're holdin' up okay.",
        "Anybody gives you grief at the counter, send 'em to me.",
        "Prices are fair, shop looks solid. You're doin' alright.",
        "Take a breather sometime. You're allowed, y'know.",
        "Catch ya later. Don't push yourself too hard now.",
      ],
      evening: [
        "Evenin', kiddo. Long day, huh? You earned this sunset.",
        "Get somethin' warm in ya before you head home tonight.",
        "You did good today. I mean it. Don't argue with me.",
        "It's gettin' dark — you walkin' home alright by yourself?",
        "Rest up, hon. Big sib's orders. G'night.",
      ],
      night: [
        "Still up, kiddo? Somebody's gotta tell you to sleep.",
        "Don't stay out too late. Town's quiet, but still.",
        "You alright? You can talk to me, day or night.",
        "Lock up and get to bed. The loot'll wait for you.",
        "Night, champ. Sleep tight, and I mean it.",
      ],
    },
  },
  {
    id: "gus", name: "Gus", variant: "l", personality: "zen",
    buyLines: {
      boughtLoved: [
        "Took home a {item}. It's enough. Enough is a fine place to arrive.",
        "Got a {item}. I'll use it well and want for nothing else. That's the trick.",
      ],
      boughtWhim: [
        "A {item} found its way to me. I didn't chase it. Things arrive when they arrive.",
        "Bought a {item}, unplanned. No matter. The river doesn't plan its bends.",
      ],
      passedPricey: [
        "The {item} was fine, but wanting less is its own kind of wealth, friend.",
        "Let the {item} be. What you don't carry, you don't have to set down later.",
      ],
      passedMeh: [
        "Nothing called to me, and that's a peaceful sort of answer too.",
        "Bought nothing. Left lighter than I came. Not a bad trade, really.",
      ],
    },
    wishLines: [
      "A little simple food is all I need, friend. Nothing costly, nothing to weigh me down.",
      "Keep something plain and honest on the shelf — bread, a herb for tea. That's plenty.",
    ],
    lines: {
      morning: [
        "Morning. Feel that air? Costs nothing, worth everything. Breathe it in.",
        "No rush, friend. The day's long enough for those who don't hurry it.",
        "I watched the mist lift off the fields. Best thing I'll do all day, maybe.",
        "You carry a lot on those shoulders. Set some down now and then, hm?",
        "I'll drift along. The morning and I have an understanding: we take it slow.",
      ],
      afternoon: [
        "Afternoon. Found a warm patch of sun. Sat in it. Recommend it highly.",
        "That cave takes what it takes. Go gentle, come back gentle. No need to prove a thing.",
        "A quiet hour's not empty, friend. It's just full of quiet. Different thing.",
        "You're doing fine. Truly. The doing's plenty — the fretting's optional.",
        "I'll wander on. Nowhere to be is a lovely place to be headed.",
      ],
      evening: [
        "Evening. The light lets go so easy this hour. We could learn from it.",
        "Sunset asks nothing of you. Just to be seen. Simplest thing in the world.",
        "You worked hard. Now let the day close. It knows how, if you let it.",
        "A bowl of something warm, a long breath, a clear head. That's a rich man's evening.",
        "I'll head off slow. Stillness keeps better company than most folk, no offence.",
      ],
      night: [
        "Still up? The night's patient. It'll wait while you find your calm.",
        "Can't sleep? Don't wrestle it. Just lie still and let the quiet do the rest.",
        "Look up. Same stars, every night, asking nothing. Steadying, that.",
        "Worries feel bigger in the dark. They shrink by morning. They always do.",
        "Goodnight, friend. Let the day go. You can pick a new one up tomorrow.",
      ],
    },
  },
  {
    id: "vera", name: "Vera", variant: "m", personality: "gossip",
    buyLines: {
      boughtLoved: [
        "Ooh, I got a {item}! Wait'll the whole street hears. They'll be SO jealous.",
        "Snagged a {item}. Now, don't tell anyone — actually, do. Tell everyone.",
      ],
      boughtWhim: [
        "Bought a {item} on a whim! You know me, I simply cannot keep anything in.",
        "A {item} just leapt into my basket. Speaking of leaping — have you HEARD?",
      ],
      passedPricey: [
        "Wanted the {item}, but between us? I heard cheaper's coming. A little bird told me.",
        "Left the {item}. At that price? Someone's got notions. I'll be asking around.",
      ],
      passedMeh: [
        "Nothing worth buying, but oh, the things I OVERHEARD. Where do I start.",
        "Bought nothing, learned everything. That's a good day's shopping, dear.",
      ],
    },
    wishLines: [
      "Stock a bit of everything folk'll TALK about, dear — pretty trinkets, nice treats.",
      "Sweet things and shiny things, that's what gets tongues wagging. And oh, I do love that.",
    ],
    lines: {
      morning: [
        "Morning! You'll never guess who I saw sneaking home at dawn. Guess. Go on.",
        "Have you HEARD? No? Oh, sit down, this is a good one, I promise you.",
        "Between you and me — and don't repeat it — the baker's got a new admirer.",
        "I know everything that happens on this street. It's a gift. And a duty.",
        "Must dash! I've news to deliver and it spoils if you keep it too long.",
      ],
      afternoon: [
        "Afternoon! So-and-so bought so-and-so a whatsit. The IMPLICATIONS, dear.",
        "Your shop's the best spot in town for watching folk. I sit here for hours.",
        "I'd tell you what the neighbours said about YOU, but I'm far too discreet. Ha!",
        "Word is you drove a hard bargain yesterday. Word travels. I make sure of it.",
        "Right, off to check on a rumour before it goes and changes shape on me.",
      ],
      evening: [
        "Evening! You should've SEEN the fuss at the well today. I'll spare you. I won't.",
        "Lovely dusk. Perfect light for peeking through a curtain, not that I would.",
        "Busy day for you — I counted your customers. And noted a few. For posterity.",
        "Did you hear about the Mayor's new statue plans? Straight from the source. Ish.",
        "Off to swap the day's news over tea. It's practically a public service, dear.",
      ],
      night: [
        "Out late? Ooh, that's the kind of thing people TALK about, you know. Careful.",
        "Can't sleep — my head's too full of everyone else's business. Occupational hazard.",
        "Quiet street tonight. Suspiciously quiet. Somebody's up to something, mark me.",
        "One last bit of news and I'm off, I swear. Well. Two. It's a two-news night.",
        "Goodnight! And if anything scandalous happens, you know where to find me. First.",
      ],
    },
  },
  {
    id: "bruno", name: "Bruno", variant: "n", personality: "boastful",
    buyLines: {
      boughtLoved: [
        "Bagged a {item}! Finest one they had, obviously — I only buy the best.",
        "Got the {item}. Bet nobody in town owns one like it. Well. Now they don't.",
      ],
      boughtWhim: [
        "Grabbed a {item} on a whim. When you've got my instincts, every whim's gold.",
        "Bought a {item} without blinking. That's decisiveness, that is. I've loads.",
      ],
      passedPricey: [
        "That {item}? Pricey, sure. Not that I can't afford it — I choose not to. Big difference.",
        "Left the {item}. I've three better at home. Probably. Somewhere. You'll see.",
      ],
      passedMeh: [
        "Nothin' here's a match for the stuff I've already got. No offence.",
        "Nothin' grabbed me. Hard to impress a man who's seen what I've seen, eh?",
      ],
    },
    wishLines: [
      "Bring in weapons a man can BRAG about, eh — big blades, trophies. Stuff worth a tale.",
      "I want the heavy, the impressive, the folk-will-stare gear. Nothin' small for Bruno!",
    ],
    lines: {
      morning: [
        "Morning! Up before dawn, me. Wrestled a fog off the road on the way in.",
        "You dive that cave? Cute. I once went so deep I came out the other side.",
        "Fine morning. Not as fine as the one I had in the mountains, but fine.",
        "Ask anyone — best haggler this side of the river. That's just fact.",
        "Right, off I go. Places to be, legends to add to. You know how it is.",
      ],
      afternoon: [
        "Afternoon! Tell you what, I've hauled loot that'd break a lesser back.",
        "That trophy? Reminds me of the beast I fought bare-handed. Bigger, mine was.",
        "Sell me your heaviest blade. I like a weapon folk'll gawk at, see.",
        "You're doing alright, kid. Not Bruno-alright, but alright. Keep at it.",
        "Later! I'd stay, but the town can't tell its tales with me standin' about.",
      ],
      evening: [
        "Evening! Watched a sunset once made this one look like a candle. True story.",
        "Long day? I've had longer. Three days once, no sleep, saved a whole village.",
        "You did decent work today. Reminds me of me, back when I was learnin'.",
        "See that scar? No? Well, it's there. Got it doin' somethin' heroic. Trust me.",
        "Off to dinner. I eat big — a legend's got to keep his strength up, eh!",
      ],
      night: [
        "Still up? So'm I. Sleep's for folk without stories to top, ha!",
        "Night like this, I'd usually be off chasing something dangerous. Usually.",
        "I could tell you how I once out-stared a wolf, but you'd never believe it.",
        "The dark doesn't scare me. Never has. Ask the dark — it'll tell you.",
        "Night! Dream big, kid. Won't top mine, but give it a go, eh!",
      ],
    },
  },
  {
    id: "hazel", name: "Hazel", variant: "o", personality: "foodie",
    buyLines: {
      boughtLoved: [
        "Got a {item} and oh — the flavour, dear. I could weep. Happy tears.",
        "That {item}'s a triumph. I'll be dreaming about it till breakfast.",
      ],
      boughtWhim: [
        "I bought a {item} on a whim. My stomach put the order in, not my head.",
        "A {item}? Couldn't help it, dear. It smelled far too good to walk past.",
      ],
      passedPricey: [
        "The {item} looked divine, but that price would empty my pantry. Next time.",
        "I sniffed the {item}, sighed, and set it down. A tragedy for my tastebuds.",
      ],
      passedMeh: [
        "Nothing made my mouth water today. A dry sort of visit, sadly.",
        "Had a good look, dear, but nothing worth ruining my appetite over.",
      ],
    },
    wishLines: [
      "Food, dear — good food. The finer the fare, the faster I'll empty your shelves.",
      "Keep the pantry stocked with something delicious and you'll never be rid of me.",
    ],
    lines: {
      morning: [
        "Morning! I've a loaf in the oven and I can't stop thinking about lunch.",
        "Smell that? No? Pity. My kitchen's a symphony this hour, dear.",
        "You can't dive on an empty stomach. Sit, eat, then be brave.",
        "I'm after good honey today. A day without honey is barely a day.",
        "Off to check my dough. It waits for no one, that dough.",
      ],
      afternoon: [
        "Afternoon! I've tasted everything in the market twice. Research, dear.",
        "A good meal fixes most troubles. The rest need a second helping.",
        "You look peckish. Don't argue — I know peckish when I see it.",
        "If you ever roast that cave meat, come find me. I've opinions. Strong ones.",
        "I must dash. Something's simmering and it needs my full devotion.",
      ],
      evening: [
        "Evening! Supper's the whole point of a day, if you ask me.",
        "The light's the colour of caramel. Now I want caramel. See what you've done.",
        "You worked hard, so you'll eat well tonight. I insist on it, dear.",
        "Come by for a bowl of stew. There's always more in the pot than sense.",
        "Off home to my kitchen. It misses me. I miss it more.",
      ],
      night: [
        "Still up? A little midnight bite never hurt anyone. Much.",
        "I bake at odd hours. Bread has no clock, and neither, tonight, do I.",
        "Warm milk and a crust — that's my cure for a restless night, dear.",
        "Don't sleep hungry. It's bad luck, and worse dreams. Trust a baker.",
        "Goodnight. I'll leave something sweet on your step, mind you eat it.",
      ],
    },
  },
  {
    id: "silas", name: "Silas", variant: "p", personality: "inventor",
    buyLines: {
      boughtLoved: [
        "Got a {item}! Do you know how many moving parts— never mind. It's perfect.",
        "The {item} is mine. I'm going to take it apart immediately. For science.",
      ],
      boughtWhim: [
        "Bought a {item}. Not sure why yet. I'll have invented a reason by tomorrow.",
        "A {item}? Impulse. But every good contraption starts with 'ooh, what's that'.",
      ],
      passedPricey: [
        "Wanted the {item}, but I'd only have dismantled it. Save us both the grief.",
        "The {item} tempted me — imagine the mechanisms! But my coin-purse said no.",
      ],
      passedMeh: [
        "Nothing sparked an idea today. Rare. I usually leave with three at least.",
        "Browsed, tinkered mentally, bought nothing. The blueprints stay in my head.",
      ],
    },
    wishLines: [
      "Anything with gears or a hinge or a spring — bring it in! I can't resist a mechanism.",
      "Stock gadgets and clever gear, would you? The more moving parts, the happier I am.",
    ],
    lines: {
      morning: [
        "Morning! I've been up since three — had an idea, then it had another idea.",
        "Careful, I may have left a spring somewhere about your floor. Or three.",
        "If you rigged a little bell to that door, you'd never miss a customer. I could—",
        "I'm after gears today. And wire. And that thing, you know the thing. That.",
        "Must dash — I left something bubbling. Or ticking. One of the two.",
      ],
      afternoon: [
        "Afternoon! Wait — hold that thought, I've nearly solved my own from breakfast.",
        "Everything's a machine if you squint. That cave? Enormous clockwork, I'd wager.",
        "Sell me anything with a hinge. Hinges are wildly underrated, you know.",
        "You've a tidy shop. Tidy's good. Tidy's the enemy of invention, mind, but good.",
        "Off to the workshop! Something in there just went 'clunk'. Optimistic clunk.",
      ],
      evening: [
        "Evening! I built a lamp that follows you round. It mostly follows the cat.",
        "Look at those gears in the sky — no, wait, stars. Habit. Beautiful either way.",
        "You did good work today. Systematic. I respect a well-run system, I do.",
        "I'll fix that squeaky sign of yours. Eventually. I've a queue of ideas, see.",
        "Home to the bench. Don't wait up — invention keeps dreadful hours.",
      ],
      night: [
        "Still up? Best hours for thinking, the quiet ones. No one interrupts the—",
        "I've a prototype that'll change everything. Or explode. Fifty-fifty, honestly.",
        "The dark's just a problem waiting for a brighter lamp. I'm working on it.",
        "Sorry — I trailed off. Where was I? Ah. No idea. That happens a lot.",
        "Goodnight! If you hear a bang around midnight, that's progress. Probably.",
      ],
    },
  },
  {
    id: "mayor", name: "The Mayor", variant: "q", personality: "pompous", reserved: true,
    buyLines: {
      boughtLoved: [
        "I procured a {item}! A landmark purchase. I shall commission a plaque.",
        "The {item} is mine — nay, the TOWN'S, through me, its humble figurehead.",
      ],
      boughtWhim: [
        "I bought a {item} on impulse. History is made by bold men. And by me.",
        "A spontaneous {item}! Let the record show the Mayor stimulates commerce daily.",
      ],
      passedPricey: [
        "The {item} tempted me, but a statesman guards the public purse. Applause, please.",
        "I declined the {item}. Prudence! Fiscal responsibility! Put that in the minutes.",
      ],
      passedMeh: [
        "Nothing today befitted the dignity of my office. We must aim higher, town.",
        "I surveyed the wares and abstained. A leader must never be seen to overspend.",
      ],
    },
    wishLines: [
      "Stock treasure befitting the township's dignity — grand, glittering, worthy of ME. Ahem.",
      "Show me splendour! Gems, crowns, things that trumpet civic magnificence. And mine.",
    ],
    lines: {
      morning: [
        "Ah, the heir! Rise and shine for the greater glory of the township!",
        "A fine morning — and might I say, finer for having me in it. Ahem.",
        "As I declared in my Address to the Geese this dawn: onward, prosperity!",
        "Every shutter you open, I regard as a personal civic triumph. Mine.",
        "Carry on! I've a proclamation to proclaim. It won't proclaim itself.",
      ],
      afternoon: [
        "The heir, hard at work! I shall reference this in Tuesday's speech. At length.",
        "Every roof you raise reflects, in some small way, on my visionary leadership.",
        "The cave? A jewel in our town's crown! A terrifying, revenue-generating jewel!",
        "Commerce! The music of a well-run township. And I do conduct such a fine one.",
        "Carry on, carry on. Greatness rests on the shoulders of shopkeepers. And mayors.",
      ],
      evening: [
        "Behold the sunset over MY township! I take, naturally, partial credit.",
        "A fine day's trade — I shall commemorate it in bronze. Or at least in speech.",
        "You've restored the old street! I shall cut the ribbon. I brought my own scissors.",
        "Dusk falls upon a prosperous town. Prosperity being, of course, my doing.",
        "Off to dine with dignitaries — that is, with myself, the finest of them. Ta!",
      ],
      night: [
        "Burning the midnight oil? A dedicated public servant never rests! I, however, do.",
        "The township sleeps, safe under my watch. You may express your gratitude anytime.",
        "Even by moonlight, this street stands as a monument to my administration.",
        "Do lock up. Prosperity, like fame, attracts the wrong sort after dark.",
        "Goodnight, heir! I shall dream of ribbon-cuttings. And, modestly, of statues.",
      ],
    },
  },
  {
    id: "maple", name: "Maple", variant: "r", personality: "outdoorsy",
    buyLines: {
      boughtLoved: [
        "Got a {item}! Perfect for the trail. Good kit's worth more than gold out there.",
        "Snagged a {item}. That'll see me through many a muddy mile, this will.",
      ],
      boughtWhim: [
        "Bought a {item} on a whim. Eh — a body finds a use for most things outdoors.",
        "A {item} caught my eye. Grabbed it. Improvising's half the fun of the wild.",
      ],
      passedPricey: [
        "Wanted that {item}, but I can likely rig somethin' from the woods for free.",
        "Left the {item} be. Coin's better spent on boots that'll cross a river, I say.",
      ],
      passedMeh: [
        "Nothin' I couldn't forage myself today. Still, nice to be out and about.",
        "Had a look, bought nowt. The fields gave me plenty this mornin' anyhow.",
      ],
    },
    wishLines: [
      "Rugged kit and hearty food, that's the trail-goer's list. Stock those and I'm yours, eh.",
      "Sturdy boots, a good blade, a proper meal — that's what a life outdoors runs on.",
    ],
    lines: {
      morning: [
        "Mornin'! Already been out to the ridge and back. Dew's grand this hour.",
        "Brought you some wild herbs — found 'em by the creek. Cost you nothin'.",
        "Best light for foraging, early like this. Berries practically wave at you.",
        "Headed into that cave? Pack water and a good rope. The outdoors don't forgive.",
        "Right, the trail's callin'. Fresh air won't breathe itself!",
      ],
      afternoon: [
        "Afternoon! Muddy to the knees and happy for it. That's a proper day.",
        "You cooped up in here all day? Come out sometime, I'll show you the good spots.",
        "Sell me sturdy boots and a sharp blade — that's a whole life's kit right there.",
        "Weather's turnin' by dusk, mark me. My knees and the wind agree on that.",
        "Off to check my snares and my berry patch. Nature keeps a busy schedule!",
      ],
      evening: [
        "Evenin'! Watched a hawk ride the wind home. Beats any show, that.",
        "Sun's dippin' behind the hills just right. I never tire of that one.",
        "You put in a solid day. Nothin' beats honest work, indoors or out.",
        "Got a fire and a full pot waitin' back at camp. You're welcome to it.",
        "Headin' out while there's light on the path. Sleep sound, eh!",
      ],
      night: [
        "Still up? Come look — the sky's proper clear tonight, stars right down to the trees.",
        "I sleep better under open sky, truth be told. Roofs feel a bit stingy with it.",
        "Owls are out. Fox too, by the sound. The night shift's busier than folk think.",
        "Cold's comin' in. Bank your fire and mind your toes, that's my advice.",
        "Night! First bird at dawn, that's my alarm. Never once let me down.",
      ],
    },
  },
];

// The ambient crowd is the whole town — everyone roams the street and shops,
// the Mayor and the Clerk included. Their scripted set-pieces (see
// game-narrative.js) briefly "hold" their skin so no doppelgänger roams while
// the cameo is on stage; the `reserved` flag just tags who has such a cameo.
export const CROWD_NPCS = NPCS;

const _byId = new Map(NPCS.map((n) => [n.id, n]));
const _byVariant = new Map(NPCS.map((n) => [n.variant, n]));

export function npcById(id) {
  return _byId.get(id) || null;
}

export function npcByVariant(variant) {
  return _byVariant.get(variant) || null;
}

// The display name of an NPC's personality voice, e.g. "Peppy".
export function personalityName(npc) {
  return PERSONALITIES[npc?.personality]?.name || "";
}

// The shopper characteristic (customer archetype name) an NPC always shops as,
// derived from their personality — e.g. a Peppy villager is a "Collector".
// Returns an ARCHETYPES name (see shop-data.js); defaults to "Regular".
export function personalityArchetype(npc) {
  return PERSONALITIES[npc?.personality]?.archetype || "Regular";
}

// A townsperson's taste (see PERSONALITIES.taste) — what kind of goods tempt
// them and whether they lean cheap or costly. Always returns a usable shape so
// callers can read `.kinds[kind]` (defaulting to 1) and `.tierLean` safely.
const _DEFAULT_TASTE = { kinds: {}, tierLean: 0 };
export function personalityTaste(npc) {
  return PERSONALITIES[npc?.personality]?.taste || _DEFAULT_TASTE;
}

// The four outcomes a shopper reflects on after a visit — what they'll tell the
// player next time they chat (see game-narrative _talkToNpc). `item` = whether
// the line refers to a specific item (so the sim knows to fill {item} in).
export const REFLECTION_BUCKETS = [
  { id: "boughtLoved", label: "Loved it & bought", item: true },
  { id: "boughtWhim", label: "Bought on a whim", item: true },
  { id: "passedPricey", label: "Wanted it, passed", item: true },
  { id: "passedMeh", label: "Nothing caught their eye", item: false },
];

// Pick one of an NPC's purchase-reasoning lines for the given outcome bucket,
// filling in {item} with the item's name. `roll` is a 0–1 number (so callers
// can seed it); returns null if the NPC has no line for that bucket.
export function npcBuyLine(npc, bucket, itemName = "", roll = Math.random()) {
  const pool = npc?.buyLines?.[bucket];
  if (!pool || !pool.length) return null;
  const line = pool[Math.floor(roll * pool.length) % pool.length];
  return line.replace(/\{item\}/g, itemName || "that");
}

// A townsperson's "wishlist" aside — a hint at their taste (see PERSONALITIES
// .taste: what kind of goods tempt them, cheap or costly) that they drop right
// after a shopping trip, nudging the player toward the sort of stock they'd buy.
// Two per person, authored in their own voice; `roll` is a 0–1 number so callers
// can seed the pick. Returns null if the townsperson has no wish lines.
export function npcWishLine(npc, roll = Math.random()) {
  const pool = npc?.wishLines;
  if (!pool || !pool.length) return null;
  return pool[Math.floor(roll * pool.length) % pool.length];
}

// Item-specific reactions: certain signature items get a bespoke line instead of
// the generic templated one, only when they actually *buy* it (loved it, or an
// out-of-character whim). Curated per personality voice — the items echo what
// that temperament already goes on about (the Peppy/Dreamer's sparkly treasures,
// the Lazy/Foodie's snacks, Cranky's honest cave kit, the Snooty/Smug/Pompous's
// finery, the Jock/Boastful's heavy gear, the homely Normal/Sisterly/Zen's food,
// the Bookish/Inventor's gadgets). Keyed by personality → item id → bucket. Any
// item/bucket without an entry simply falls back to buyLines.
// {item} is still filled in with the item's name.
export const SPECIAL_REACTIONS = {
  peppy: {
    gem: {
      boughtLoved: ["A {item}! It's like holding a tiny sunrise, eee! Mine forever!"],
      boughtWhim: ["The {item} sparkled and POOF, my coins were gone. Worth every one!"],
    },
    star: {
      boughtLoved: ["I got a {item}! An actual STAR! I'm basically cosmic now, hee!"],
      boughtWhim: ["The {item} twinkled at me. What was I gonna do, NOT buy it?!"],
    },
    crystal: {
      boughtLoved: ["My very own {item}! All purple and glittery, I can't cope!"],
      boughtWhim: ["Grabbed a {item} 'cause it shimmered. Totally valid reason, right?!"],
    },
    crown: {
      boughtLoved: ["A {item}?! I'm ROYALTY now! Okay, a shopkeeper's pal with a crown!"],
      boughtWhim: ["Bought a {item} on impulse and now I'm fancy. No big deal, hee!"],
    },
  },
  lazy: {
    bread: {
      boughtLoved: ["Got the {item}. Warm, soft, no chewin' effort. Perfect food, honestly."],
      boughtWhim: ["The {item} was right there. Reachin' for it was the most I've moved all day."],
    },
    meat: {
      boughtLoved: ["A whole {item}. Now THIS is worth stayin' awake for. Mmn."],
      boughtWhim: ["Bought a {item}. Didn't plan to. Smelled good. That's the whole story."],
    },
    mushroom: {
      boughtLoved: ["Snagged a {item}. Snack of champions. Well, snack of nappers."],
      boughtWhim: ["A {item} kinda fell into my hands. Wasn't gonna fight it."],
    },
    jelly: {
      boughtLoved: ["The {item} wobbles AND you can eat it. Two hobbies in one. Love it."],
      boughtWhim: ["Bought a {item}. It jiggled. I was powerless, honestly."],
    },
  },
  cranky: {
    lantern: {
      boughtLoved: ["Got a {item}. A body needs light down that cave. Sensible purchase."],
      boughtWhim: ["Bought a {item}. Well. Beats stubbin' my toe in the dark, I suppose."],
    },
    shield: {
      boughtLoved: ["A {item}. Now that's honest kit. Keeps a fool from gettin' flattened."],
      boughtWhim: ["Walked out with a {item}. Bah. Can't say it won't come in handy."],
    },
    wsword: {
      boughtLoved: ["Got the {item}. Simple, sturdy, does the job. Like things used to be made."],
      boughtWhim: ["Bought a {item}. Don't need it. Might. Hmph."],
    },
    boots: {
      boughtLoved: ["The {item}. My knees'll thank me, and they never thank anyone."],
      boughtWhim: ["Bought {item}. My old ones had holes. Fine. There, I said it."],
    },
  },
  snooty: {
    crown: {
      boughtLoved: ["The {item} is mine. Finally, something befitting one's station."],
      boughtWhim: ["I acquired a {item}. A whim, but a regal one, naturally."],
    },
    gem: {
      boughtLoved: ["A {item} of true quality. I shall be the envy of lesser browsers."],
      boughtWhim: ["The {item} caught the light just so. One does deserve nice things."],
    },
    amulet: {
      boughtLoved: ["The {item} has breeding. I can always tell. It's a gift, really."],
      boughtWhim: ["I took the {item}. An indulgence. I am, after all, worth it."],
    },
    ring: {
      boughtLoved: ["This {item} is almost tasteful enough for my hand. Almost. I'll allow it."],
      boughtWhim: ["A {item}, on impulse. Even careless, I have exquisite instincts."],
    },
  },
  jock: {
    ssword: {
      boughtLoved: ["Got the {item}! Look at the WEIGHT on this, champ! Gains incoming!"],
      boughtWhim: ["Grabbed a {item} on impulse. It's heavy. Heavy is good. Sold!"],
    },
    armor: {
      boughtLoved: ["The {item}! Extra weight to haul AND it guards the gains. Perfect!"],
      boughtWhim: ["Bought {item} outta nowhere. Feels like a weighted vest. LOVE that!"],
    },
    shield: {
      boughtLoved: ["A {item}, champ! Great for blockin' AND for arm day. Two-in-one!"],
      boughtWhim: ["Snagged a {item}. Didn't need it. Do now. That's how it works, ha!"],
    },
    fang: {
      boughtLoved: ["The {item}! A trophy AND a workout to carry. Whoo, let's GO!"],
      boughtWhim: ["Bought a {item} on a whim. It's heavy, it's metal. Say no more!"],
    },
  },
  normal: {
    bread: {
      boughtLoved: ["Got a lovely {item}, dear. Fresh-baked's the heart of a good day."],
      boughtWhim: ["Bought a {item} on a whim. You can never have too much, can you?"],
    },
    herb: {
      boughtLoved: ["The {item}! Just the thing for the pot tonight. Ever so pleased."],
      boughtWhim: ["Picked up a {item}, dear. It'll come in handy in the kitchen, I'm sure."],
    },
    meat: {
      boughtLoved: ["A fine {item}, dear. That's supper sorted, and a happy table with it."],
      boughtWhim: ["Bought a {item} on impulse. A little treat for the household, why not."],
    },
    potion: {
      boughtLoved: ["Got a {item} — for scrapes and sniffles. Best to be prepared, dear."],
      boughtWhim: ["Took a {item} home. One likes to keep something handy for a poorly day."],
    },
  },
  smug: {
    amulet: {
      boughtLoved: ["The {item} suits me. Then again, what doesn't? A fine acquisition."],
      boughtWhim: ["I took a {item} on a whim. It'll look marvellous against my collar."],
    },
    ring: {
      boughtLoved: ["This {item} was made for a hand like mine. Elegant. Effortless. Me."],
      boughtWhim: ["A spontaneous {item}. My fingers, like the rest of me, deserve adornment."],
    },
    crown: {
      boughtLoved: ["A {item}. Some are born to wear such things. I simply bought one."],
      boughtWhim: ["I acquired a {item}. Overkill? For anyone else. For me, merely fitting."],
    },
    bell: {
      boughtLoved: ["The {item} rings as sweetly as my reputation. Naturally I bought it."],
      boughtWhim: ["A {item}, on a whim. It'll announce my arrivals rather handsomely."],
    },
  },
  sisterly: {
    bread: {
      boughtLoved: ["Got the {item}, kid. Nobody in my house goes hungry, not on my watch."],
      boughtWhim: ["Bought a {item} on a whim. Always room for more at the table, champ."],
    },
    meat: {
      boughtLoved: ["A good {item}, hon. That's a proper meal in someone tonight. Job done."],
      boughtWhim: ["Grabbed a {item}. Somebody needs feedin' up — they always do."],
    },
    potion: {
      boughtLoved: ["Got a {item}, kid. For when someone comes home banged up. Big sib's ready."],
      boughtWhim: ["Bought a {item} on impulse. Better to have it and not need it, y'know?"],
    },
    armor: {
      boughtLoved: ["The {item}. If my folks won't stay outta trouble, they'll stay protected."],
      boughtWhim: ["Snagged some {item}. Sturdy. I like knowin' someone's covered, champ."],
    },
  },
  dreamer: {
    star: {
      boughtLoved: ["A {item}... a real piece of the sky, in my hands. I'll never quite believe it."],
      boughtWhim: ["The {item} glimmered and I forgot everything else. Some wonders choose you."],
    },
    crystal: {
      boughtLoved: ["My {item} catches the light like frozen water. I could gaze at it for hours."],
      boughtWhim: ["The {item} hummed a little colour at me. I drifted over and it was mine."],
    },
    gem: {
      boughtLoved: ["The {item} holds a whole sunrise inside. I felt it the moment I touched it."],
      boughtWhim: ["A {item} winked at me from the shelf. I answered without meaning to."],
    },
    flower: {
      boughtLoved: ["A {item} — soft and small and perfect. The best wonders always are."],
      boughtWhim: ["The {item} smelled like a half-remembered dream. I couldn't leave it behind."],
    },
  },
  bookish: {
    tome: {
      boughtLoved: ["A {item}! Pages, actual pages. I'll have it read and cross-referenced by dawn."],
      boughtWhim: ["Bought a {item} on impulse. A book is never truly an impulse, though, is it."],
    },
    lantern: {
      boughtLoved: ["The {item}. One cannot read in the dark, and I intend to read a great deal."],
      boughtWhim: ["A {item}, unplanned. Still — proper light is a scholar's first tool. Justified."],
    },
    amulet: {
      boughtLoved: ["The {item}'s craftsmanship is exemplary. I checked the hallmarks. Twice. Superb."],
      boughtWhim: ["Took the {item} on a whim. The workmanship simply demanded documentation."],
    },
    key: {
      boughtLoved: ["A {item}! Every key implies a lock, and every lock, a mystery. I'm delighted."],
      boughtWhim: ["Bought a {item}. No idea what it opens. That, precisely, is the appeal."],
    },
  },
  foodie: {
    bread: {
      boughtLoved: ["The {item} — still warm, dear. This is what a good day tastes like. Bliss."],
      boughtWhim: ["Bought a {item} on a whim. The crust crackled at me. What was I to do?"],
    },
    meat: {
      boughtLoved: ["A proper {item}! Season it right and I'll be the happiest soul in town tonight."],
      boughtWhim: ["Grabbed a {item}. Unplanned, but my mouth had already made the decision, dear."],
    },
    herb: {
      boughtLoved: ["The {item}! You've no idea what this does to a stew. Transformative. I could cry."],
      boughtWhim: ["A {item} on impulse. A pinch of the right thing turns supper into an occasion."],
    },
    jelly: {
      boughtLoved: ["The {item} wobbles just so. Chilled, with a spoon — pure joy in a bowl, dear."],
      boughtWhim: ["Bought a {item}. It jiggled invitingly. My willpower, for once, did not."],
    },
  },
  boastful: {
    ssword: {
      boughtLoved: ["The {item}! Now THIS is a blade folk'll remember. Like the one I lost to a bear."],
      boughtWhim: ["Grabbed a {item}. Bigger than the last fella's, I'd wager. Much bigger."],
    },
    fang: {
      boughtLoved: ["A {item}! A trophy worthy of me. I've felled beasts twice the size, mind. Twice."],
      boughtWhim: ["Bought a {item} on a whim. It'll look grand mounted over my many, many others."],
    },
    crown: {
      boughtLoved: ["The {item} is mine! They'll say I earned it in battle. I'll not correct them."],
      boughtWhim: ["A {item}, on impulse. A man of my legend ought to own at least one, eh."],
    },
    shield: {
      boughtLoved: ["The {item}! Saved my life a dozen times, a shield like this has. Will again."],
      boughtWhim: ["Snagged a {item}. Didn't need it — I usually just dodge — but it'll impress folk."],
    },
  },
  inventor: {
    lantern: {
      boughtLoved: ["A {item}! Give me an evening and I'll have it brighter, longer, and slightly on fire."],
      boughtWhim: ["Bought a {item}. Already picturing the modifications. So many modifications."],
    },
    hourglass: {
      boughtLoved: ["The {item}! Gears of sand — genius, whoever made it. I'll better it, obviously."],
      boughtWhim: ["A {item} on a whim. I simply had to know what makes the sand behave. For science."],
    },
    bell: {
      boughtLoved: ["The {item}! Rig it to a lever and a string and — oh, the contraptions, the contraptions."],
      boughtWhim: ["Grabbed a {item}. A good clear ring is a criminally underused mechanism, you know."],
    },
    key: {
      boughtLoved: ["A {item}! I'll reverse-engineer the whole lock mechanism by supper. Marvellous."],
      boughtWhim: ["Bought a {item} on impulse. Tumblers and springs — I could study one for days."],
    },
  },
  pompous: {
    crown: {
      boughtLoved: ["The {item}! Fitting for the town's foremost citizen. I shall wear it to ribbon-cuttings."],
      boughtWhim: ["A {item}, on impulse — but a leader must look the part. The public expects it."],
    },
    gem: {
      boughtLoved: ["The {item} shall glitter in the town hall as a monument to my splendid tenure."],
      boughtWhim: ["Bought a {item}. Extravagant? For a lesser man. For a mayor, merely appropriate."],
    },
    bell: {
      boughtLoved: ["A {item}! It shall announce my speeches. And my arrivals. And my other speeches."],
      boughtWhim: ["A {item}, on a whim. Every great administration deserves a great fanfare, ahem."],
    },
    amulet: {
      boughtLoved: ["The {item} lends me gravitas. Not that I lack it — but one can never have too much."],
      boughtWhim: ["Took a {item} on impulse. A statesman's regalia is a civic investment, really."],
    },
  },
  gossip: {
    bell: {
      boughtLoved: ["A {item}! Now everyone'll know when I've arrived — with news, naturally. Perfect."],
      boughtWhim: ["Bought a {item} on a whim. A good ring gathers a crowd, and a crowd loves a story."],
    },
    ring: {
      boughtLoved: ["This {item}! Wait till they see it at the well. They'll ASK. And oh, I'll tell."],
      boughtWhim: ["A {item}, on impulse. It'll get folk talking — and I do so love to give them cause."],
    },
    gem: {
      boughtLoved: ["A {item}! Half the fun's watching the neighbours turn green. The other half's the sparkle."],
      boughtWhim: ["Bought a {item} without thinking. Between us, I bought it purely to be seen with it."],
    },
    bread: {
      boughtLoved: ["The {item}! Nothing loosens tongues like sharing a warm loaf. Purely strategic, dear."],
      boughtWhim: ["Grabbed a {item}. Tea and gossip go hand in hand, and one can't pour on an empty plate."],
    },
  },
  zen: {
    herb: {
      boughtLoved: ["The {item}. Steeped slow, sipped slower. A quiet cup settles most of the world."],
      boughtWhim: ["A {item} came my way. Simple things, taken gently — that's plenty, friend."],
    },
    bread: {
      boughtLoved: ["The {item}. Warm, plain, enough. Wanting nothing more is a full sort of feeling."],
      boughtWhim: ["Took a {item}, unplanned. A humble loaf asks nothing of you. I like that in a meal."],
    },
    mushroom: {
      boughtLoved: ["A {item} from the quiet dark. Nature gives freely to those who don't grab, friend."],
      boughtWhim: ["A {item} found me. I let it. No sense wrestling what the day hands you gently."],
    },
    berries: {
      boughtLoved: ["The {item}. Sweet, small, and gone by morning. A fine lesson in enjoying the now."],
      boughtWhim: ["Bought a {item} on a whim. A handful of sweetness costs little and settles the soul."],
    },
  },
  outdoorsy: {
    boots: {
      boughtLoved: ["The {item}! These'll cross a river and climb a ridge and still ask for more. Grand."],
      boughtWhim: ["Grabbed a {item}. Can never have too many — the trail chews through 'em, it does."],
    },
    meat: {
      boughtLoved: ["A {item}! Roast it over a campfire under open sky — no finer supper anywhere, I say."],
      boughtWhim: ["Bought a {item} on a whim. A long day's hike earns a body a proper hot meal, eh."],
    },
    berries: {
      boughtLoved: ["The {item}! Half of foraging's knowing which won't do you in. These, I know. Lovely."],
      boughtWhim: ["A {item} on a whim — though I'd usually just pick my own by the creek, truth be told."],
    },
    lantern: {
      boughtLoved: ["A {item}! Worth its weight when the trail runs on past dusk. Reliable kit, this."],
      boughtWhim: ["Grabbed a {item}. Out in the wild after dark, good light's the difference, believe me."],
    },
  },
};

// Resolve the line a townsperson says about their trip: a bespoke item-specific
// reaction if one exists for their personality + this item + bucket, otherwise
// their generic buyLine. {item} is filled with the item's name either way.
export function npcReflectionLine(npc, bucket, itemId, itemName = "", roll = Math.random()) {
  const special = SPECIAL_REACTIONS[npc?.personality]?.[itemId]?.[bucket];
  const pool = special && special.length ? special : npc?.buyLines?.[bucket];
  if (!pool || !pool.length) return null;
  const line = pool[Math.floor(roll * pool.length) % pool.length];
  return line.replace(/\{item\}/g, itemName || "that");
}
