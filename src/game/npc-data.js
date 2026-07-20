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
// `arriveLines` are the asides they mutter as they head in to shop (shown as a
// floating speech bubble on the way to the door — see npcArriveLine).
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
    arriveLines: [
      "Shop time, shop time! Ooh, I can't WAIT to see what's new!",
      "Eee, I'm gonna buy something today, I just KNOW it!",
      "Skippety-skip to the shop! Best errand EVER!",
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
    arriveLines: [
      "Hmph. Suppose I'll see if there's anything worth buying.",
      "Better not be overpriced junk again. We'll see.",
      "In and out, that's the plan. No dawdling.",
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
    arriveLines: [
      "Ooh, let me pop in and see what's on the shelves, dear.",
      "I do enjoy a little browse of an afternoon.",
      "Best see if there's anything nice for the house.",
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
    arriveLines: [
      "Time to inspect the stock. I keep a mental ledger, you know.",
      "Let's see whether today's prices are correctly set. They rarely are.",
      "A quick, orderly browse. In and catalogued by half past.",
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
    arriveLines: [
      "Shop run, let's GO champ! Errands count as cardio!",
      "Time to scope the gains on the shelves, whoo!",
      "Powerwalkin' to the shop! Feel that burn!",
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
    arriveLines: [
      "Let's see if anything's worthy of my company today.",
      "A little shopping. Everything looks better once I've browsed it.",
      "Time to grace the shop with my exquisite taste.",
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
    arriveLines: [
      "One supposes one must see if the stock has improved.",
      "Do let there be something befitting my standards today.",
      "Off to browse. I shan't lower my expectations, darling.",
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
    arriveLines: [
      "I wonder what little wonders are waiting today...",
      "The shop's calling, soft as a daydream. I'll drift over.",
      "Maybe something that glimmers is waiting for me.",
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
    arriveLines: [
      "Ugh, fine, I'll go look. Cheaper than growin' my own snacks.",
      "Shop's close enough. Barely counts as effort. Barely.",
      "Gonna go buy a snack. Then a nap. Priorities.",
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
    arriveLines: [
      "Right, off to the shop. Somebody in my house always needs somethin'.",
      "Let's see what's worth pickin' up for the family, hon.",
      "In we go, kiddo. I'll grab what we need and be gone.",
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
    arriveLines: [
      "A gentle wander to the shop. No rush, no fuss.",
      "The shelves will show me what I need, friend. Or nothing. Both are fine.",
      "I'll drift in and see what the day offers.",
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
    arriveLines: [
      "Ooh, off to the shop — bet there's news to hear AND goods to buy!",
      "A browse AND a natter? My favourite kind of errand, dear.",
      "Let's see what everyone's been buying. Purely research!",
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
    arriveLines: [
      "Off to the shop! They'll want to see me, no doubt.",
      "Time to find gear worthy of my many legends, eh.",
      "Bruno's shoppin'! Clear the aisle, folk'll want a look.",
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
    arriveLines: [
      "Ooh, let's see if there's anything delicious in today, dear.",
      "Off to the shop — my stew won't season itself!",
      "I can practically smell a good bargain. To the shelves!",
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
    arriveLines: [
      "To the shop! Maybe something with gears I can tinker with.",
      "Let's see what mechanisms are waiting to be improved.",
      "Off to browse — every gadget's a project in disguise!",
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
    arriveLines: [
      "The Mayor shall grace the shop with his patronage. Ahem.",
      "Let us see what splendour befits a man of my office.",
      "A civic duty, this — supporting local trade. And myself.",
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
    arriveLines: [
      "Off to the shop — need to restock the trail kit, eh.",
      "Let's see if there's sturdy gear worth haulin' home.",
      "A quick supply run, then back to the open air!",
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

// A townsperson's little "on my way to the shop" aside — the line that floats
// over their head (see hud.speechBubble) as they peel off the street and head
// for the door. In their own voice; three per person. `roll` is a 0–1 number so
// callers can seed the pick (keeping host/guest in sync). Returns null if the
// townsperson has no arrival lines.
export function npcArriveLine(npc, roll = Math.random()) {
  const pool = npc?.arriveLines;
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

// ---- occasions: what day it is ---------------------------------------------
// Townsfolk greet you differently on notable calendar days — the seasonal
// holidays first (Easter, Halloween, Christmas…), then a lighter day-of-the-week
// flavour. Each occasion carries a `test(date)` predicate resolved against the
// real (or an admin-pinned) date; the list is priority-ordered, so a holiday
// always wins over a weekday. `mood` is a core/icons.js key for the admin panel.
// The spoken lines live in OCCASION_LINES, keyed by personality (with a generic
// _default fallback), so a face you meet on Halloween reads in its own voice.

// Gregorian Easter Sunday (Meeus/Jones/Butcher algorithm) for a given year,
// returned as a { month:0-11, date } so the occasion test can match it — Easter
// wanders by lunar reckoning, so it can't be a fixed calendar day.
export function easterFor(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const date = ((h + l - 7 * m + 114) % 31) + 1;
  return { month: month - 1, date };
}

// True if `date` falls within `spanDays` on/after Easter Sunday (so the shop's
// Easter greeting covers the long weekend, not just the Sunday).
function isEaster(date, spanDays = 2) {
  const e = easterFor(date.getFullYear());
  const sunday = new Date(date.getFullYear(), e.month, e.date);
  const diff = Math.floor((date - sunday) / 86400000);
  return diff >= 0 && diff <= spanDays;
}

export const OCCASIONS = [
  { id: "newyear", label: "New Year", mood: "faceStar", test: (d) => d.getMonth() === 0 && d.getDate() === 1 },
  { id: "valentines", label: "Valentine's Day", mood: "faceHappy", test: (d) => d.getMonth() === 1 && d.getDate() === 14 },
  { id: "easter", label: "Easter", mood: "faceHappy", test: (d) => isEaster(d) },
  { id: "halloween", label: "Halloween", mood: "faceConfused", test: (d) => d.getMonth() === 9 && d.getDate() === 31 },
  { id: "christmas", label: "Christmas", mood: "faceStar", test: (d) => d.getMonth() === 11 && (d.getDate() === 24 || d.getDate() === 25) },
  // the lighter day-of-the-week flavour — only used when no holiday is running
  { id: "weekend", label: "Weekend", mood: "faceSmile", test: (d) => d.getDay() === 0 || d.getDay() === 6 },
  { id: "monday", label: "Monday", mood: "faceNeutral", test: (d) => d.getDay() === 1 },
  { id: "friday", label: "Friday", mood: "faceSmile", test: (d) => d.getDay() === 5 },
];

const _occById = new Map(OCCASIONS.map((o) => [o.id, o]));

export function occasionById(id) {
  return _occById.get(id) || null;
}

// Every occasion active on `date`, priority-ordered (holidays before weekdays).
export function activeOccasions(date = new Date()) {
  return OCCASIONS.filter((o) => {
    try { return o.test(date); } catch { return false; }
  });
}

// The single top-priority occasion for `date` (or null on an ordinary day).
export function activeOccasion(date = new Date()) {
  return activeOccasions(date)[0] || null;
}

// Per-personality occasion greetings, with a generic _default pool so every
// resident always has something to say on a given day even without a bespoke
// line. One line per personality per holiday keeps each voice distinct; the
// day-of-the-week flavour leans on the shared _default.
export const OCCASION_LINES = {
  _default: {
    newyear: [
      "Happy new year! A fresh ledger, a fresh start — make it a good one.",
      "New year, new stock, new luck. The whole town's feeling hopeful today.",
    ],
    valentines: [
      "Happy Valentine's! Even a shopkeeper deserves a little sweetness today.",
      "Love's in the air — and a few extra coins for treats, I'd wager.",
    ],
    easter: [
      "Happy Easter! The whole town's out hunting painted eggs.",
      "Spring's here and so's Easter — everything feels new-hatched today.",
    ],
    halloween: [
      "Happy Halloween! They say the cave's spookier than usual tonight.",
      "Spooky night! The little ones are out in their monster masks.",
    ],
    christmas: [
      "Merry Christmas! The whole street's strung with lights tonight.",
      "Happy Christmas! A warm shop on a cold night — bless you for opening.",
    ],
    weekend: [
      "Weekend at last — the street's in no hurry today.",
      "Lovely lazy weekend. Folk are out just to wander and browse.",
    ],
    monday: [
      "Monday again. The town's a touch slow to wake, but here we are.",
      "Fresh week ahead. Let's make it a busy one at the counter.",
    ],
    friday: [
      "Friday! Folk have coin in their pockets and a spring in their step.",
      "End of the week — expect a livelier crowd through the door tonight.",
    ],
  },
  peppy: {
    newyear: ["Happy new yeeear! I already made a hundred resolutions, hee!"],
    valentines: ["Happy Valentine's! I made everyone a card. EVERYONE. Even the cat!"],
    easter: ["Eee, Easter! I found SO many eggs I lost count twice!"],
    halloween: ["Boo! Happy Halloween! My costume's the sparkliest ghost EVER!"],
    christmas: ["Merry Christmas!! I've been good ALL year. Mostly. Hee!"],
  },
  cranky: {
    newyear: ["New year. Same me. Don't expect resolutions — too old to change. Hmph."],
    valentines: ["Valentine's. Bah. In my day we didn't fuss. ...Happy Valentine's, then."],
    easter: ["Easter. Kids trampling my garden for eggs. Every blessed year. Hmph."],
    halloween: ["Halloween. Knock for sweets and you'll get a lecture. Fair warning."],
    christmas: ["Christmas. Suppose I'll allow a bit of cheer. Just the once. Merry Christmas, bah."],
  },
  normal: {
    newyear: ["Happy new year, dear! I've a good feeling about this one, I really do."],
    valentines: ["Happy Valentine's, dear. I've baked heart biscuits — do take one."],
    easter: ["Happy Easter, dear! I've hidden eggs all round the garden for the little ones."],
    halloween: ["Happy Halloween, dear! There's sweets by my door for the trick-or-treaters."],
    christmas: ["Merry Christmas, dear! Come in from the cold — there's mulled cider on."],
  },
  bookish: {
    newyear: ["New year. Statistically the best time to start a fresh ledger. I've started three."],
    valentines: ["Valentine's Day. Older tradition than the town itself, you know. A fact for you."],
    easter: ["Easter. The date wanders yearly by lunar reckoning — endlessly satisfying to calculate."],
    halloween: ["Halloween. Records show the cave's noticeably restless tonight. Documented. Mind it."],
    christmas: ["Merry Christmas. I've catalogued my gifts by size, then usefulness. Efficient, no?"],
  },
  jock: {
    newyear: ["New year, new PRs, champ! Resolution number one: more reps! Whoo!"],
    valentines: ["Happy Valentine's! Nothin' says love like a matching workout, am I right?!"],
    easter: ["Easter egg hunt's basically cardio, champ! I found forty. FORTY!"],
    halloween: ["Happy Halloween! My costume's just gym gear. Scary how swole, right? Ha!"],
    christmas: ["Merry Christmas! Big feast means big gains tomorrow, LET'S GO!"],
  },
  smug: {
    newyear: ["New year. I resolve to stay effortlessly charming. Achieved already, naturally."],
    valentines: ["Valentine's — my busiest day. So many admirers, so little of me to share. Alas."],
    easter: ["Easter. I needn't hunt for eggs; lovely things simply find their way to me."],
    halloween: ["Halloween. I went as myself. Terrifyingly handsome, everyone agreed."],
    christmas: ["Merry Christmas. My gift to the town is, as ever, my presence."],
  },
  snooty: {
    newyear: ["A new year, darling. One trusts the town will finally acquire some taste."],
    valentines: ["Valentine's. I received admirers, obviously. Quality over quantity, of course."],
    easter: ["Easter. I do hope the egg-hunting rabble keeps clear of my hedges, darling."],
    halloween: ["Halloween. Such a common little holiday. I'm dressed as good breeding."],
    christmas: ["Merry Christmas, I suppose. Do keep the decorations tasteful, darling."],
  },
  dreamer: {
    newyear: ["A whole new year, untouched... like fresh snow nobody's walked on yet."],
    valentines: ["Valentine's. Love's just a warm colour, isn't it? The whole town glows pink today."],
    easter: ["Easter. Little painted eggs hidden like secrets the garden's keeping. Lovely."],
    halloween: ["Halloween. The veil feels thin tonight — like the dark's just daydreaming back."],
    christmas: ["Christmas lights look like fallen stars caught in the eaves. I could gaze for hours."],
  },
  lazy: {
    newyear: ["New year. My resolution? Nap more. I'm already ahead of schedule, mmn."],
    valentines: ["Valentine's. Effort. But chocolate's involved, so... okay, I'm in. Barely."],
    easter: ["Easter. Egg hunt? Nah. If one rolls to me, I'll eat it. That's my hunt."],
    halloween: ["Happy Halloween. My costume's a blanket. I'm a very tired ghost. Mmn."],
    christmas: ["Merry Christmas. Best holiday — basically socially approved napping."],
  },
  sisterly: {
    newyear: ["Happy new year, kiddo! Same rule as ever: you look after yourself, hear?"],
    valentines: ["Happy Valentine's, hon. Don't let nobody spend it alone — round 'em up, I say."],
    easter: ["Happy Easter, kiddo! Hid eggs for the little ones. You can hunt too, I won't tell."],
    halloween: ["Happy Halloween, hon! Walk the little trick-or-treaters home safe tonight, yeah?"],
    christmas: ["Merry Christmas, kiddo! Table's set for anyone with nowhere to be. That includes you."],
  },
  zen: {
    newyear: ["A new year, friend. Same breath, same quiet. No need to chase it — just begin."],
    valentines: ["Valentine's. Kindness costs nothing and warms two people. That's plenty, friend."],
    easter: ["Easter. New shoots, longer light. The world renews with no fuss. We could learn from it."],
    halloween: ["Halloween. Even the dark likes to play tonight. Let it, and stay easy, friend."],
    christmas: ["Merry Christmas. A warm room, good company, a full breath — a rich man's day, friend."],
  },
  gossip: {
    newyear: ["Happy new year, dear! Oh, the resolutions I've heard folk break already — do ask!"],
    valentines: ["Valentine's! And oh, the whispers — who sent whom what. I know it ALL, dear."],
    easter: ["Happy Easter! Someone hid the eggs terribly this year. I have theories. Several."],
    halloween: ["Happy Halloween! Behind every mask, a secret — and I'll have every one by dawn."],
    christmas: ["Merry Christmas, dear! Whose gift cost what — oh, the tallying I've done already."],
  },
  boastful: {
    newyear: ["New year, eh! I resolve to top last year's legends. Bold, I know. I'm bold."],
    valentines: ["Valentine's! I got so many cards the postman needed help. True story."],
    easter: ["Easter! I'd have found the golden egg first, if I'd looked. Busy man, me."],
    halloween: ["Halloween! Scariest fella in town, me. The monsters dress up as ME, eh!"],
    christmas: ["Merry Christmas! I once wrestled a snowstorm to save the feast. Ask anyone."],
  },
  foodie: {
    newyear: ["Happy new year, dear! First meal of the year sets the tone — make it a feast."],
    valentines: ["Happy Valentine's! I've been baking heart-shaped everything since dawn, dear."],
    easter: ["Happy Easter! Egg hunt, then egg feast. That's the correct order, I assure you."],
    halloween: ["Happy Halloween! Toffee apples, pumpkin pie — spooky season is DELICIOUS season."],
    christmas: ["Merry Christmas, dear! The oven's not cooled in days and I couldn't be happier."],
  },
  inventor: {
    newyear: ["New year! A resolution list, a fireworks contraption, and only minor burns so far."],
    valentines: ["Valentine's — I built a little clockwork heart. It beats! Mostly. Occasionally sideways."],
    easter: ["Easter! Built an automatic egg-hunter. It found my breakfast and hid it. Iterating."],
    halloween: ["Halloween! My pumpkin's got gears and a lantern. It winks. Or it's stuck. Fifty-fifty."],
    christmas: ["Merry Christmas! Rigged the tree lights to blink in sequence. Blew a fuse. Worth it."],
  },
  pompous: {
    newyear: ["A new year for MY township! I shall proclaim its greatness at length. Happy new year, ahem."],
    valentines: ["Valentine's Day — the town's affection for its Mayor is, naturally, most touching."],
    easter: ["Easter! I shall officiate the egg hunt personally. With my own ceremonial basket."],
    halloween: ["Halloween. I've dressed as a great statesman. That is, myself, in a fetching cape."],
    christmas: ["Merry Christmas! I've a speech, a feast, and a ribbon to cut. Chiefly the speech."],
  },
  outdoorsy: {
    newyear: ["Happy new year, eh! First hike of the year at dawn cleared my head lovely."],
    valentines: ["Valentine's. Picked wildflowers for half the town. Cost nowt, meant plenty, eh."],
    easter: ["Happy Easter! Best egg hunt's out in the meadow. I know all the good hiding spots."],
    halloween: ["Happy Halloween! Owls out, mist low — the wild does spooky better than any costume."],
    christmas: ["Merry Christmas, eh! Snow on the ridge this mornin' — prettiest gift there is."],
  },
};

// The line a townsperson greets you with on a given occasion — their bespoke
// voice line if they have one, else the shared _default. Returns null on an
// ordinary day (or an unknown occasion). `roll` seeds the pick.
export function npcOccasionLine(npc, occasionId, roll = Math.random()) {
  if (!occasionId) return null;
  const own = OCCASION_LINES[npc?.personality]?.[occasionId];
  const pool = own && own.length ? own : OCCASION_LINES._default[occasionId];
  if (!pool || !pool.length) return null;
  return pool[Math.floor(roll * pool.length) % pool.length];
}

// ---- player deeds: reacting to what you just did ---------------------------
// When the player pulls off something notable underground — felling a dungeon
// boss, or pushing to a new deepest floor — the news travels the town, and the
// next townsperson you chat with leads with it (once per person; see
// game-narrative recordPlayerDeed / _takeNpcDeed). {boss}, {place} and {floor}
// are filled from the deed. Keyed by personality, generic _default fallback.
export const PLAYER_DEEDS = [
  { id: "bossFelled", label: "Felled a boss", mood: "faceStar" },
  { id: "newDepth", label: "Reached a new depth", mood: "faceSmile" },
];

const _deedById = new Map(PLAYER_DEEDS.map((d) => [d.id, d]));

export function playerDeedById(id) {
  return _deedById.get(id) || null;
}

export const DEED_LINES = {
  _default: {
    bossFelled: [
      "Word is you brought down {boss}! The whole town's talking about it.",
      "They say you felled {boss} down in {place}. Quite the feat!",
    ],
    newDepth: [
      "Floor {floor}? You're going deeper than anyone dares. Mind yourself down there.",
      "I heard you reached floor {floor} in {place}. Braver than me, that's certain.",
    ],
  },
  peppy: {
    bossFelled: ["You beat {boss}?! EEE, you're basically a HERO now, hee!", "The whole town heard about {boss} — I told everyone TWICE!"],
    newDepth: ["Floor {floor}?! That's SO deep, I'd get the wobbles, eee!", "You went ALL the way to floor {floor}? You're the bravest, hee!"],
  },
  cranky: {
    bossFelled: ["Heard you put {boss} down. Hmph. Not bad, kid. Not bad at all.", "So {boss} finally fell. About time someone had the spine for it."],
    newDepth: ["Floor {floor}? Daft. Brave, but daft. Mind you come back up.", "Deeper than's sensible, floor {floor}. Don't go gettin' cocky."],
  },
  normal: {
    bossFelled: ["I heard you bested {boss}, dear. The whole street's so proud of you.", "You saw off {boss}? Do be careful down there — but well done, truly."],
    newDepth: ["Floor {floor}, dear? Goodness. You will come home safe, won't you?", "All the way to floor {floor}! I'll put an extra bun by for you."],
  },
  bookish: {
    bossFelled: ["You felled {boss}. I've logged it — the first such entry in the ledger. Remarkable.", "{boss}, defeated. Statistically, few manage it. You're in the record now."],
    newDepth: ["Floor {floor}. That's a new personal deepest — I do keep track, naturally.", "Reached floor {floor}, did you? The deep floors predate the town, you know."],
  },
  jock: {
    bossFelled: ["YO, you dropped {boss}?! Personal best, champ, LET'S GO!", "{boss} down! Boss fights are just heavy cardio, and you CRUSHED it!"],
    newDepth: ["Floor {floor}, champ?! That's endurance gains right there, whoo!", "You pushed to floor {floor}? Respect — that's the grind payin' off!"],
  },
  smug: {
    bossFelled: ["You bested {boss}? How dashing. Almost as impressive as me. Almost.", "Word of your {boss} triumph reached me. I allowed myself a small clap."],
    newDepth: ["Floor {floor}? Bold. I'd go myself, but the lighting down there is dreadful.", "So you've seen floor {floor}. I prefer to be admired at surface level, personally."],
  },
  snooty: {
    bossFelled: ["You slew {boss}? Well. Perhaps you've a touch of quality after all, darling.", "{boss}, was it? One supposes that IS the sort of thing worth doing. Barely."],
    newDepth: ["Floor {floor}? How frightfully grubby. Effective, I'll grant, but grubby.", "You descended to floor {floor}? Do bathe before you next call, darling."],
  },
  dreamer: {
    bossFelled: ["You quieted {boss}... the deep feels a little softer now, don't you think?", "They say you met {boss} and won. Some battles echo like dropped stones."],
    newDepth: ["Floor {floor}... imagine the dark that far down. Does it dream too, I wonder?", "You touched floor {floor}. That's near the bottom of a very long sigh."],
  },
  lazy: {
    bossFelled: ["You beat {boss}? Mmn. That sounds like a LOT of moving. Respect, honestly.", "Heard about {boss}. Just hearing it made me need a nap. Nice one, though."],
    newDepth: ["Floor {floor}? That's a lotta stairs, man. I'd have stopped at, like, two.", "You went to floor {floor}? Ugh. Tired just picturing the walk back."],
  },
  sisterly: {
    bossFelled: ["You took down {boss}, kiddo? C'mere — big sib's proud. Now, you eat yet?", "{boss}'s beaten and you're in one piece? Good. That's all I ask, hon."],
    newDepth: ["Floor {floor}?! Don't you dare go deeper without tellin' me first, kiddo.", "All the way to floor {floor}. Brave, hon — brave AND gettin' a scolding."],
  },
  zen: {
    bossFelled: ["So {boss} rests now. You carried something heavy and set it down. Enough, friend.", "You bested {boss}. Notice the quiet after? That's the real prize."],
    newDepth: ["Floor {floor}. Deep water, that. Go gentle, come back gentle — no need to prove a thing.", "You reached floor {floor}, friend. The dark's patient. So should you be."],
  },
  gossip: {
    bossFelled: ["Have you HEARD — oh, of course you have, YOU did it! {boss}, felled! Delicious.", "The whole well was buzzing about your {boss} win, dear. I may have embellished. A little."],
    newDepth: ["Floor {floor}?! Everyone's talking — and for once I didn't start it. Well. Mostly.", "You reached floor {floor}, they say. And oh, do they say. I'll keep the details spicy."],
  },
  boastful: {
    bossFelled: ["You dropped {boss}, eh? Ha! I once felled three at once. Still, good effort.", "{boss}, beaten! Nearly as grand as my own legends. NEARLY, mind."],
    newDepth: ["Floor {floor}? Pfft, I've been deeper. Probably. Good on you, though.", "You saw floor {floor}? I once went so deep I came out the other side. Respectable, that."],
  },
  foodie: {
    bossFelled: ["You beat {boss}, dear? That calls for a celebration pie. I'll get baking!", "{boss} down! A hero works up an appetite — sit, I'll fix you a plate."],
    newDepth: ["Floor {floor}?! You must be famished, dear. Nobody delves that deep on an empty stomach.", "All the way to floor {floor}! I'm making stew. You're having two bowls, no arguments."],
  },
  inventor: {
    bossFelled: ["You bested {boss}? Fascinating — I'd love to study how its guard dropped. For science!", "{boss}, down! If I'd rigged a spring-trap— oh, never mind, you managed."],
    newDepth: ["Floor {floor}? The mechanisms that deep must be ANCIENT. Bring me a cog if you spot one!", "You reached floor {floor}? I've a lamp-contraption that'd help down there. Mostly works."],
  },
  pompous: {
    bossFelled: ["You vanquished {boss}! A triumph for the township — and, by extension, for ME. Ahem.", "{boss} has fallen! I shall commission a plaque. Small print for you, large for the office."],
    newDepth: ["Floor {floor}? The revenue-generating depths of MY jewel of a cave! Splendid, splendid.", "You reached floor {floor}? I shall reference this civic milestone in Tuesday's address."],
  },
  outdoorsy: {
    bossFelled: ["You brought down {boss}, eh? Now that's a trail worth walkin'. Grand work.", "{boss} beaten! Toughest country in town, that cave. You read it well."],
    newDepth: ["Floor {floor}? That's proper deep country, eh. Pack water and mind your footing.", "You made floor {floor}! Furthest track in town. I'd hike it with you sometime."],
  },
};

// The line a townsperson says about a fresh player deed — their bespoke voice
// line if they have one, else the shared _default — with {boss}/{place}/{floor}
// filled from the deed context. Returns null for an unknown deed. `roll` seeds
// the pick.
export function npcDeedLine(npc, deedId, ctx = {}, roll = Math.random()) {
  if (!deedId) return null;
  const own = DEED_LINES[npc?.personality]?.[deedId];
  const pool = own && own.length ? own : DEED_LINES._default[deedId];
  if (!pool || !pool.length) return null;
  const line = pool[Math.floor(roll * pool.length) % pool.length];
  return line
    .replace(/\{boss\}/g, ctx.boss || "the keeper")
    .replace(/\{place\}/g, ctx.place || "the cellar")
    .replace(/\{floor\}/g, ctx.floor != null ? ctx.floor : "the deep");
}
