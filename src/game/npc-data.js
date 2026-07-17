// The town's named residents. Every Kenney "Blocky" skin (character-b … r —
// the hero keeps "a") is a distinct person with a name, a personality voice,
// and their own lines of small talk. The shop's shoppers and the street's
// passers-by are drawn from this roster so a face on screen is always the same
// townsperson, never an anonymous body — and the allocator (see shop.js) makes
// sure no two people on screen at once wear the same skin.
//
// Personality voices take after the classic cozy-village archetypes (peppy,
// lazy, cranky, snooty, jock, normal, smug, sisterly). The flavour is the
// inspiration; every line below is written fresh for Coin Cellar.

// The eight personality voices. `mood` maps to a face icon (see core/icons.js)
// so the admin panel and any emote can show the temperament at a glance.
// `archetype` is the townsperson's "shopper characteristic" — the customer
// archetype (see ARCHETYPES in shop-data.js) they always shop as. It's fixed by
// temperament so the same face haggles the same way every visit: eager peppy
// fans splurge like Collectors, snooty and smug folk buy like the Wealthy,
// grumbling cranky and can't-be-bothered lazy types pinch coins like
// Cheapskates, and the steady normal/jock/sisterly crowd shop as Regulars.
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
    id: "nib", name: "Nib the Clerk", variant: "e", personality: "normal", reserved: true,
    buyLines: {
      boughtLoved: [
        "Treated myself to a {item}. Old habits — I do know a good one.",
        "Got a {item}. Even a retired clerk can't resist a fine piece.",
      ],
      boughtWhim: [
        "Bought a {item}. Force of habit more than need, I'll admit.",
        "Walked out with a {item}. The counter instinct never quite leaves you.",
      ],
      passedPricey: [
        "Eyed that {item}, but I've priced enough goods to know when to wait.",
        "The {item} tempted me. I put it back. Discipline, that.",
      ],
      passedMeh: [
        "Nothing I needed today. Just keeping my eye in.",
        "Had a browse, bought nowt. Sometimes that's the sensible call.",
      ],
    },
    lines: {
      morning: [
        "Morning! Or is it? Hard to keep track down in that cave.",
        "Counter's all yours now. Suits you better than it did me.",
        "We keep an early eye out for divers. Habit, I suppose.",
        "Fresh start every day. That's the shopkeeper's life.",
        "Holler if you need a hand. That's what I'm here for.",
      ],
      afternoon: [
        "Afternoon! Busy stretch, this. Good for business.",
        "If you go too deep and drop, we'll haul you home. Again.",
        "You're getting the hang of the counter. I can tell.",
        "Slow moment? Enjoy it. They don't last long round here.",
        "Back to it, then. Give me a shout if you're stuck.",
      ],
      evening: [
        "Evening. Winding down? Wise. It's been a long one.",
        "We do one last sweep for stragglers before dark.",
        "You ran a fine shop today. The old owner'd be proud.",
        "Count your till before you close. Saves headaches.",
        "Head home safe. I'll see the lamps are lit.",
      ],
      night: [
        "Late shift, eh? You and me both, then.",
        "Nights are when the deep floors get restless. Stay sharp.",
        "Nobody left topside but us. Quiet's earned, I'd say.",
        "Get some sleep soon. The counter'll keep till morning.",
        "Goodnight. Don't let the cave keep you up.",
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
    id: "sunny", name: "Sunny", variant: "i", personality: "peppy",
    buyLines: {
      boughtLoved: [
        "I got a {item}! Ahh, it's SO me, I can't even!",
        "The {item} is MINE now and I love-love-LOVE it!",
      ],
      boughtWhim: [
        "Bought a {item} without thinking! Best kind of buying, wheee!",
        "Oops, a {item} followed me home! Impulse, hee!",
      ],
      passedPricey: [
        "I really wanted that {item}, but I'm being good with my coins!",
        "The {item} was so shiny, ahh! Saving up though, gotta be strong!",
      ],
      passedMeh: [
        "Nothing sparkled at me today, weird huh?!",
        "Looked at it all and my heart just went 'meh'. So rare!",
      ],
    },
    lines: {
      morning: [
        "Morning! The sun's up and I'm SO ready, ahh!",
        "New day, new adventures! Where do we even start?!",
        "I waved at every bird already. They love me, I think!",
        "You went in the CAVE again? So brave it's silly!",
        "Byeee! Go make the morning amazing, superstar!",
      ],
      afternoon: [
        "Hi hi! The day's halfway gone and I've done nothing yet!",
        "Ooh, is that new? Is it for sale? Is it for sale NOW?!",
        "One day I'll travel everywhere. Everywhere everywhere!",
        "Your shop's the best stop in town, I've decided!",
        "See ya! Save me the sparkly stuff, pretty please!",
      ],
      evening: [
        "Whoa, look at that sunset! It's SO orange, I love it!",
        "Golden hour makes me wanna twirl. So I'm gonna. Wheee!",
        "Today was a good one. I can just feel it, y'know?!",
        "One more wander before the stars come out, come on!",
        "Nighty-night soon! Dream big, okay? Real big!",
      ],
      night: [
        "It's late but the night's too pretty to sleep, right?!",
        "Stars everywhere! I wanna scoop 'em up in a jar!",
        "Shhh, the whole town's dreaming. Except us! Hee!",
        "I should sleep. But adventures don't wait for bedtime!",
        "Okay okay, goodnight! See ya bright and early!",
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
    id: "gus", name: "Gus", variant: "l", personality: "lazy",
    buyLines: {
      boughtLoved: [
        "Got a {item}. Effort well spent, and I don't say that lightly.",
        "Mmn, a {item}. That one's worth the walk over. Cozy buy.",
      ],
      boughtWhim: [
        "Bought a {item}. Was easier than decidin' not to, y'know?",
        "A {item} sorta happened. I let it. Too comfy to argue.",
      ],
      passedPricey: [
        "Kinda wanted the {item}. Kinda didn't wanna spend. Guess who won.",
        "The {item} was nice. My coins were nicer where they were, though.",
      ],
      passedMeh: [
        "Nothin' woke me up today. Which, fair, takes a lot.",
        "Had a look. Had a yawn. Left empty-handed. Classic.",
      ],
    },
    lines: {
      morning: [
        "Mmn? Oh, mornin'. I was restin' my eyes. And my legs.",
        "Too early for talkin'. But hey, here we are, I guess.",
        "You're chipper for this hour. Must be exhausting.",
        "Wake me when the pastries arrive. Not a second sooner.",
        "Right. Back to my mornin' sit. Very demanding, it is.",
      ],
      afternoon: [
        "Nice and quiet in here. Good spot for a little sit.",
        "You went down that cave? Sounds tiring. Tired me out just hearin' it.",
        "Afternoons are for slowin' down. I'm an expert, really.",
        "Don't mind me. Just resting up for more resting.",
        "Alright, alright... back to my busy schedule of nothin'.",
      ],
      evening: [
        "Evenin'. Now THIS is my kinda pace. Nice and slow.",
        "Sunset's free entertainment. I never miss it. From my seat.",
        "You worked all day? Just picturing it wears me out.",
        "Dinner, then a good long sit. Perfect evening, that.",
        "Welp. Gonna go rest somewhere softer. Night.",
      ],
      night: [
        "Zzz— oh. Evenin'. Or night. Whichever needs less effort.",
        "Nights are for sleepin'. Way ahead of everyone there.",
        "Might just doze right here. Chair's warm, I'm comfy.",
        "Any pastries left over? No? ...Back to sleep it is.",
        "G'night. Don't wake me unless it's a snack.",
      ],
    },
  },
  {
    id: "vera", name: "Vera", variant: "m", personality: "snooty",
    buyLines: {
      boughtLoved: [
        "I claimed the {item}. At last, an item of genuine breeding.",
        "The {item} will do nicely. And I am not easily done nicely by.",
      ],
      boughtWhim: [
        "I bought a {item}. A moment of weakness. It happens to the best.",
        "A {item}, on impulse. Even my impulses outclass most people's plans.",
      ],
      passedPricey: [
        "The {item} nearly tempted me. Nearly. I have standards to keep.",
        "I inspected the {item} and found it wanting. As I found everything.",
      ],
      passedMeh: [
        "Nothing today rose to my level. Predictable, frankly.",
        "I saw not one thing worth owning. Do restock with taste.",
      ],
    },
    lines: {
      morning: [
        "You may address me. Yes, I'm this fabulous before noon.",
        "Morning light is so unforgiving. On others, thankfully.",
        "A proper vitrine at last. About time someone had standards.",
        "I've been awake for ages. Beauty like mine needs upkeep.",
        "Do carry on. I've a reputation to maintain elsewhere.",
      ],
      afternoon: [
        "Afternoon. The town's finally awake enough to admire me.",
        "If it isn't rare, darling, it isn't worth my coin.",
        "I heard the last owner had no eye for quality. Tragic.",
        "One likes to be seen at the fashionable hour. So, here I am.",
        "That's quite enough mingling. Ta.",
      ],
      evening: [
        "Evening. The dusk is almost as dramatic as I am.",
        "I dress for the sunset. It's the least it deserves.",
        "You call this a display? ...Fine. It's passable. Barely.",
        "Golden hour flatters even the plainest wares. Even yours.",
        "I'm off to be adored elsewhere. Do keep up.",
      ],
      night: [
        "Out this late? How daring. Not that it suits you.",
        "The stars try so hard. I sympathise, truly.",
        "Night air is dreadful for the skin. I shan't stay.",
        "Do lock your finest away. One can't be too careful.",
        "Goodnight. Try to dream in good taste, won't you.",
      ],
    },
  },
  {
    id: "bruno", name: "Bruno", variant: "n", personality: "jock",
    buyLines: {
      boughtLoved: [
        "YESSS, got a {item}! This is gonna be great for the grind!",
        "Bought a {item}, champ! Feels HEAVY, feels GOOD, whoo!",
      ],
      boughtWhim: [
        "Grabbed a {item} on impulse! Sometimes ya just gotta send it!",
        "Bought a {item} outta nowhere. No plan, all vibes, ha!",
      ],
      passedPricey: [
        "That {item} was sweet, but I gotta save up for the big gains!",
        "Wanted the {item}, champ. Rest day for the wallet, though!",
      ],
      passedMeh: [
        "Nothin' pumped me up today. Weird workout, this shoppin'!",
        "Did a full lap, nothin' clicked. Catch the gains next time!",
      ],
    },
    lines: {
      morning: [
        "HEY HEY! Push-ups done, sun's up, let's GO!",
        "Morning's for gains! You warm up yet or what?!",
        "Nothin' beats a sunrise jog. 'Cept a sunrise SHOP!",
        "You should train with me. We'll lift AND browse!",
        "Catch ya later! Don't slack on the mornin' cardio!",
      ],
      afternoon: [
        "Midday and I'm PUMPED! What'd you haul up today?!",
        "That dive's basically a workout. Respect the grind!",
        "My arms? Oh, these? Just from carryin' loot, no biggie!",
        "Sell me somethin' heavy! I need the carry practice!",
        "Later! Keep that heart rate up, champ!",
      ],
      evening: [
        "Evening burn's underway! One more set, then I chow down!",
        "Sun's clockin' out, but the gains never sleep, ha!",
        "You put in work today, I can tell. Solid, real solid!",
        "Cool-down stretches, don't skip 'em! Even I don't!",
        "Later! Big dinner, bigger sleep. That's the plan!",
      ],
      night: [
        "Still grindin' this late? Now THAT'S dedication!",
        "Night air's crisp — perfect for a moonlight jog, whoo!",
        "Rest is where the muscle grows, y'know. Don't forget!",
        "One protein snack and I'm out. Gotta recover, champ!",
        "Night! Dream about them gains, ha ha!",
      ],
    },
  },
  {
    id: "hazel", name: "Hazel", variant: "o", personality: "normal",
    buyLines: {
      boughtLoved: [
        "I got a lovely {item}, dear. Just perfect — I'm so pleased.",
        "That {item} was made for me, I'd say. A little joy, that.",
      ],
      boughtWhim: [
        "I treated myself to a {item}. A touch indulgent, but there we are.",
        "Bought a {item} on a whim, dear. Even bakers deserve a surprise.",
      ],
      passedPricey: [
        "I did like that {item}, but I'll think on it a while yet.",
        "The {item} tempted me, dear. Perhaps when I've saved a little.",
      ],
      passedMeh: [
        "Nothing quite spoke to me today, but it was lovely to look.",
        "Had a browse and a good think. Nothing came home, though.",
      ],
    },
    lines: {
      morning: [
        "Good morning! I baked too much bread again. Want some?",
        "Lovely start, isn't it? The birds are in fine voice today.",
        "Nice to see you open bright and early. Good on you.",
        "Settling in alright? Let me know if you need a thing.",
        "Have a lovely morning. It's brighter with the shop open.",
      ],
      afternoon: [
        "Afternoon! A tidy shop and a kind face — that's the recipe.",
        "I'll bring round that bread I promised. Tomorrow, surely.",
        "You've been at it all day. Don't forget to breathe, dear.",
        "The neighbours love popping in now. You've livened us up.",
        "I'll let you get on. Take good care!",
      ],
      evening: [
        "Evening! What a gentle sunset. Perfect for a slow walk.",
        "Days end so kindly here. Makes a body grateful.",
        "You did lovely work today. The town feels warmer for it.",
        "Come by for supper sometime. There's always a spare bowl.",
        "Rest well tonight, dear. You've earned it.",
      ],
      night: [
        "Still up? So am I. The quiet has its own comfort.",
        "I've left a lamp in the window, in case someone's out late.",
        "Don't work too far into the night, dear. Sleep heals.",
        "The stars are kind tonight. Do take a peek before bed.",
        "Goodnight now. Mind how you go in the dark.",
      ],
    },
  },
  {
    id: "silas", name: "Silas", variant: "p", personality: "smug",
    buyLines: {
      boughtLoved: [
        "I acquired a {item}. A fine piece — fitting, for a fine fellow.",
        "The {item} is mine. It pairs beautifully with my jawline.",
      ],
      boughtWhim: [
        "Bought a {item} on impulse. My instincts, like me, are impeccable.",
        "A {item}? A whim. But a gentleman's whims are never wrong.",
      ],
      passedPricey: [
        "The {item} was tempting, but a gentleman never appears eager.",
        "I let the {item} be. Restraint is its own kind of elegance.",
      ],
      passedMeh: [
        "Nothing measured up to me today. A recurring theme, I fear.",
        "I graced the shop, admired myself, and left. Nothing else compelled me.",
      ],
    },
    lines: {
      morning: [
        "Ah, the shopkeeper. And me, radiant as the morning. Fancy.",
        "I rose early. The mirror and I had much to discuss.",
        "A gentleman never dives in a wrinkled shirt. Remember that.",
        "You drive a hard bargain — nearly as hard as my jawline.",
        "Farewell for now. Try to have a passable morning.",
      ],
      afternoon: [
        "Afternoon. The town's at its liveliest, and so am I.",
        "You've an eye for the finer things. Naturally, so do I.",
        "I've heard such interesting things about you. All flattering.",
        "Midday suits me. Then again, every hour rather does.",
        "Do carry on. I've admirers to disappoint elsewhere.",
      ],
      evening: [
        "What a sunset. It's doing its best to match me. Sweet.",
        "Dusk is a gentleman's hour. Dramatic. Refined. Like so.",
        "A fine day behind us. Mostly mine, but I'll share credit.",
        "One dresses for the evening. A lost art round here.",
        "Farewell, friend. Try not to miss me too terribly.",
      ],
      night: [
        "Out late? A man of taste keeps intriguing hours.",
        "Moonlight is terribly flattering. Not that I need help.",
        "The stars and I have an understanding. We both dazzle.",
        "The quiet lets a fellow admire himself in peace. Bliss.",
        "Goodnight. Dream of refinement. Dream of me, essentially.",
      ],
    },
  },
  {
    id: "mayor", name: "The Mayor", variant: "q", personality: "smug", reserved: true,
    buyLines: {
      boughtLoved: [
        "I procured a {item}! A fine addition to a fine town. Mine, mostly.",
        "The {item} is mine — an investment in civic splendour, naturally.",
      ],
      boughtWhim: [
        "I bought a {item} on impulse. A mayor's caprice stimulates the economy!",
        "A spontaneous {item}! Commerce in action. You're welcome, town.",
      ],
      passedPricey: [
        "The {item} tempted me, but a prudent mayor watches the treasury.",
        "I admired the {item}. Fiscal restraint stayed my hand — re-election, you see.",
      ],
      passedMeh: [
        "Nothing today befitted my office. We'll fund better stock, perhaps.",
        "I surveyed the wares and bought nothing. A mayor mustn't be seen to overspend.",
      ],
    },
    lines: {
      morning: [
        "Ah, the heir! Up early — the pride of our little town!",
        "A prosperous morning makes a prosperous mayor. Symbiosis!",
        "Every home you restore, I take full credit for. Tradition!",
        "The town wakes and I, its humble mayor, salute it. And me.",
        "Carry on! The morning is watching. Mostly me.",
      ],
      afternoon: [
        "The heir hard at work! Marvelous for re-election, this.",
        "Every roof you raise brings more custom through your door.",
        "The cave? Splendid for tourism. Terrifying, but splendid!",
        "A busy afternoon! I do love the sound of commerce.",
        "Carry on, carry on. The town prospers, and thus, so do I!",
      ],
      evening: [
        "What a sunset over MY town! Our town. Mostly mine.",
        "A fine day's trade. I'll mention it in my next speech.",
        "You've made the old street glow again. I'll cut the ribbon!",
        "Evenings remind me how photogenic this place's become.",
        "Off to dinner with important people. Myself, chiefly. Ta!",
      ],
      night: [
        "Burning the midnight oil? A mayor never sleeps! Well, I do.",
        "The town rests, safe and prosperous. You're welcome.",
        "Even by moonlight, this street's a monument to my leadership.",
        "Do lock up. Prosperity attracts the wrong sort after dark.",
        "Goodnight, heir! Dream of ribbon-cuttings. I shall.",
      ],
    },
  },
  {
    id: "maple", name: "Maple", variant: "r", personality: "sisterly",
    buyLines: {
      boughtLoved: [
        "Got myself a {item}, kid. Just right — you pick good stock.",
        "Snagged a {item} and I couldn't be happier, champ. Solid find.",
      ],
      boughtWhim: [
        "Treated myself to a {item}. Don't usually splurge, but hey.",
        "Bought a {item} on a whim, kid. Even I get to be spontaneous.",
      ],
      passedPricey: [
        "Had my eye on that {item}, but I'll hold off for now, champ.",
        "The {item} was callin' me, kid. Comin' back for it, though.",
      ],
      passedMeh: [
        "Nothin' grabbed me today, but the shop's lookin' great, kid.",
        "Browsed a bit, bought nothin'. No shame in a look-round, champ.",
      ],
    },
    lines: {
      morning: [
        "Mornin', champ! There's the new owner, up bright and early.",
        "You eat yet? C'mon, breakfast ain't optional round me.",
        "Fresh day, kid. Go on and make it count, yeah?",
        "Tell someone before you go delvin'. Even just me.",
        "Alright, off you go. Chin up, champ!",
      ],
      afternoon: [
        "Hey, kid. Middle of the day and still standin' — proud of ya.",
        "Need a hand haulin' stock? I've got two. Just ask.",
        "Don't let the snooty ones push you around, you hear?",
        "You're runnin' this place just fine. Give yourself credit.",
        "Alright, I'm off. Holler if you need me.",
      ],
      evening: [
        "Evenin', kid. Long haul today. You held it down good.",
        "Get somethin' warm in ya before you head in for the night.",
        "That sunset's your reward for a hard day. Enjoy it.",
        "You walkin' home okay? Streets get dim out here.",
        "Rest up, champ. You did right by this town today.",
      ],
      night: [
        "Still up, kid? Somebody's gotta send you to bed. That's me.",
        "Don't stay out too late. I worry, y'know. Big sib thing.",
        "Anything on your mind? Night's a good time to talk it out.",
        "Lock up and get some sleep. The cave'll keep till mornin'.",
        "Night, champ. Sleep tight — and I mean it.",
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

// Item-specific reactions: certain signature items get a bespoke line instead of
// the generic templated one, only when they actually *buy* it (loved it, or an
// out-of-character whim). Curated per personality voice — the items echo what
// that temperament already goes on about (Peppy's sparkly treasures, the Lazy's
// snacks, Cranky's honest cave kit, the Snooty/Smug's finery, the Jock's heavy
// gear, the homely Normal/Sisterly's food). Keyed by personality → item id →
// bucket. Any item/bucket without an entry simply falls back to buyLines.
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
