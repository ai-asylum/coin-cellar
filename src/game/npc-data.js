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
export const PERSONALITIES = {
  peppy: {
    name: "Peppy",
    mood: "faceStar",
    archetype: "Collector",
    blurb: "Bubbly, breathless and starry-eyed. Everything is the best thing ever.",
  },
  lazy: {
    name: "Lazy",
    mood: "faceNeutral",
    archetype: "Cheapskate",
    blurb: "Easygoing and snack-minded. Would rather nap than hurry anywhere.",
  },
  cranky: {
    name: "Cranky",
    mood: "faceAngry",
    archetype: "Cheapskate",
    blurb: "Gruff and grumbling on the outside, quietly rooting for you underneath.",
  },
  snooty: {
    name: "Snooty",
    mood: "faceMonocle",
    archetype: "Wealthy",
    blurb: "Haughty and image-conscious. Only the finest will do, darling.",
  },
  jock: {
    name: "Jock",
    mood: "faceSmile",
    archetype: "Regular",
    blurb: "All energy and gains. Turns every errand into a workout.",
  },
  normal: {
    name: "Normal",
    mood: "faceHappy",
    archetype: "Regular",
    blurb: "Warm, level-headed and neighbourly. The heart of the town.",
  },
  smug: {
    name: "Smug",
    mood: "faceRoll",
    archetype: "Wealthy",
    blurb: "Smooth, polished and endlessly charming — mostly to themselves.",
  },
  sisterly: {
    name: "Sisterly",
    mood: "faceHuff",
    archetype: "Regular",
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
    lines: {
      morning: [
        "Morning! Or is it? Hard to keep track down in that cave.",
        "Counter's all yours now. Suits you better than it did me.",
        "We keep an early eye out for delvers. Habit, I suppose.",
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
    lines: {
      morning: [
        "Ah, the shopkeeper. And me, radiant as the morning. Fancy.",
        "I rose early. The mirror and I had much to discuss.",
        "A gentleman never delves in a wrinkled shirt. Remember that.",
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

// The ambient crowd draws from everyone except the scripted cameos, so the
// Mayor's and the Clerk's skins stay free for their set-pieces.
export const CROWD_NPCS = NPCS.filter((n) => !n.reserved);

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
