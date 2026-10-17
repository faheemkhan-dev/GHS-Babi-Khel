// api/word-of-day.js
// Vercel Serverless Function — returns the English Word of the Day
// (word + phonetic + definition + example) for the homepage.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS WAS REWRITTEN (2026-08-31) — the "Could not load today's word" bug
// ═══════════════════════════════════════════════════════════════════════════
// The previous version fetched the daily word LIVE from third-party APIs
// (api.dictionaryapi.dev, api.datamuse.com, api.wordnik.com). On the deployed
// site this broke permanently. Verified against production on 2026-08-31:
//
//   GET https://ghsbabikhel.dpdns.org/api/word-of-day  →  HTTP 502
//   {"ok":false,"detail":["Dictionary timed out after 8000ms",
//                         "No Datamuse candidate resolved"]}
//
// i.e. the serverless function itself was healthy, but its OUTBOUND calls to
// the dictionary APIs timed out from the deployment region, so every visitor
// saw "Could not load today's word. Please check your connection." Calling
// those APIs from the browser is not an alternative either — the site's CSP
// `connect-src` whitelist (vercel.json) only allows 'self' + approved
// domains, so dictionary/datamuse requests from the page are silently blocked.
//
// THE FIX — zero external dependency for the daily word:
//   The word of the day is now served from a hand-curated dictionary dataset
//   embedded below (word, IPA phonetics, part of speech, definition, example
//   sentence, synonyms for every entry). The handler is fully deterministic:
//     • a seeded PRNG picks one entry per PKT calendar date,
//     • every visitor sees the same word all day,
//     • the word changes automatically at midnight (Asia/Karachi),
//     • the response is generated in ~0 ms with NO network calls, so it can
//       never time out again.
//   The dataset is written by hand from standard dictionary definitions —
//   no upstream API is consulted for the daily word at all.
//
// The `?word=…` sub-route (double-click-any-word popup) still performs a
// best-effort LIVE lookup via the Free Dictionary API, because the popup can
// ask for arbitrary words that cannot be pre-embedded. It degrades gracefully
// (HTTP 404 → "No definition found") when the upstream is unreachable.
// ═══════════════════════════════════════════════════════════════════════════
//
// Response shape (identical to before — the React component needs NO changes):
//   {
//     ok: true,
//     word: "serendipity",
//     phonetics: [{ text: "/ˌsɛr.ənˈdɪp.ɪ.ti/", audio: "" }],
//     meanings: [
//       { partOfSpeech: "noun",
//         definitions: [{ definition: "…", example: "…", synonyms: ["…"] }] }
//     ],
//     source: "curated-offline",
//     date: "2026-08-31"
//   }

// ── Free Dictionary API (kept ONLY for the ?word= popup lookup) ────────
const DICT_URL = (w) =>
  `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`;

const FETCH_TIMEOUT_MS = 8000;

// ── Curated Word-of-the-Day dataset ────────────────────────────────────
// ~95 hand-written entries. Fields per (single-sense) entry:
//   w   — the word
//   ipa — IPA pronunciation, slash-wrapped for display
//   pos — part of speech
//   def — definition (standard dictionary style)
//   ex  — natural example sentence
//   syn — up to 4 synonyms
// A few words carry `senses: [...]` for multiple parts of speech; the
// builder normalises both shapes (see buildEntryForDate below).
const WORD_ENTRIES = [
  { w: "abundance", ipa: "/əˈbʌn.dəns/", pos: "noun",
    def: "A very large quantity of something; more than enough.",
    ex: "The valley produces an abundance of fruit every summer.",
    syn: ["plenty", "wealth", "profusion"] },
  { w: "acumen", ipa: "/ˈæk.jə.mən/", pos: "noun",
    def: "The ability to make quick, accurate judgements and good decisions.",
    ex: "Her business acumen helped the family shop grow within a year.",
    syn: ["insight", "sharpness", "shrewdness"] },
  { w: "altruism", ipa: "/ˈæl.tru.ɪ.zəm/", pos: "noun",
    def: "Concern for the happiness and well-being of others without thinking of yourself.",
    ex: "He donated his prize money to the school library out of pure altruism.",
    syn: ["selflessness", "generosity", "charity"] },
  { w: "ambiguous", ipa: "/æmˈbɪɡ.ju.əs/", pos: "adjective",
    def: "Having more than one possible meaning, so it is not clear what is intended.",
    ex: "The notice was ambiguous — nobody could tell which gate it meant.",
    syn: ["unclear", "vague", "equivocal"] },
  { w: "ambition", ipa: "/æmˈbɪʃ.ən/", pos: "noun",
    def: "A strong desire to achieve something great, such as success or honour.",
    ex: "Her ambition is to become the first doctor from her village.",
    syn: ["aspiration", "goal", "drive"] },
  { w: "appraise", ipa: "/əˈpreɪz/", pos: "verb",
    def: "To assess the value or quality of something carefully and formally.",
    ex: "An expert was invited to appraise the old manuscripts before the exhibition.",
    syn: ["assess", "evaluate", "estimate"] },
  { w: "articulate", ipa: "/ɑːˈtɪk.jə.lət/", senses: [
    { pos: "adjective",
      def: "Able to express thoughts and ideas clearly and effectively in words.",
      ex: "She gave an articulate answer that impressed the whole panel.",
      syn: ["eloquent", "fluent", "expressive"] },
    { pos: "verb", ipa: "/ɑːˈtɪk.jʊ.leɪt/",
      def: "To express an idea or feeling clearly in words.",
      ex: "He struggled to articulate why the poem moved him so deeply.",
      syn: ["voice", "state", "express"] } ] },
  { w: "assiduous", ipa: "/əˈsɪd.ju.əs/", pos: "adjective",
    def: "Showing great care, attention and steady hard work over a long period.",
    ex: "Months of assiduous practice finally earned him first position.",
    syn: ["diligent", "painstaking", "dedicated"] },
  { w: "astute", ipa: "/əˈstjuːt/", pos: "adjective",
    def: "Clever and quick to see the real situation and use it to advantage.",
    ex: "It was astute of her to keep the receipts before the audit.",
    syn: ["perceptive", "shrewd", "sharp"] },
  { w: "auspicious", ipa: "/ɔːˈspɪʃ.əs/", pos: "adjective",
    def: "Suggesting a good chance of success in the future; favourable.",
    ex: "The team's early goal was an auspicious start to the final.",
    syn: ["promising", "favourable", "encouraging"] },
  { w: "audacious", ipa: "/ɔːˈdeɪ.ʃəs/", pos: "adjective",
    def: "Bold and daring, sometimes to a surprising degree.",
    ex: "It was an audacious plan, but the students pulled it off perfectly.",
    syn: ["bold", "daring", "fearless"] },
  { w: "augment", ipa: "/ɔːɡˈment/", pos: "verb",
    def: "To make something larger or stronger by adding to it.",
    ex: "He augments his salary by teaching evening tuition classes.",
    syn: ["increase", "boost", "expand"] },
  { w: "benevolence", ipa: "/bəˈnev.əl.əns/", pos: "noun",
    def: "Kindness and a sincere desire to do good to others.",
    ex: "The new library was built through the benevolence of a local trader.",
    syn: ["kindness", "goodwill", "charity"] },
  { w: "benevolent", ipa: "/bəˈnev.əl.ənt/", pos: "adjective",
    def: "Kind, generous and caring about the welfare of others.",
    ex: "A benevolent donor paid the school fees of ten orphaned students.",
    syn: ["kind", "charitable", "generous"] },
  { w: "bravado", ipa: "/brəˈvɑː.dəʊ/", pos: "noun",
    def: "Confident behaviour meant to impress others, often hiding fear or doubt.",
    ex: "His bravado faded quickly once the exam papers were handed out.",
    syn: ["swagger", "show", "boldness"] },
  { w: "candid", ipa: "/ˈkæn.dɪd/", pos: "adjective",
    def: "Honest and direct, even when the truth is uncomfortable.",
    ex: "To be candid, your essay needs a much stronger conclusion.",
    syn: ["frank", "honest", "forthright"] },
  { w: "catalyst", ipa: "/ˈkæt.əl.ɪst/", pos: "noun",
    def: "Something that causes an important change or event to happen faster.",
    ex: "The new science lab became a catalyst for the school's interest in research.",
    syn: ["stimulus", "spark", "trigger"] },
  { w: "conundrum", ipa: "/kəˈnʌn.drəm/", pos: "noun",
    def: "A confusing and difficult problem or question.",
    ex: "How to fund the class trip became a real conundrum for months.",
    syn: ["puzzle", "dilemma", "riddle"] },
  { w: "deliberate", ipa: "/dɪˈlɪb.ər.ət/", senses: [
    { pos: "adjective",
      def: "Done intentionally or after careful thought.",
      ex: "Leaving the gate open was a deliberate act of mischief.",
      syn: ["intentional", "purposeful", "planned"] },
    { pos: "verb", ipa: "/dɪˈlɪb.ə.reɪt/",
      def: "To think something over carefully before making a decision.",
      ex: "The judges deliberated for an hour before announcing the winner.",
      syn: ["ponder", "consider", "weigh"] } ] },
  { w: "dexterity", ipa: "/dekˈster.ə.ti/", pos: "noun",
    def: "Skill and speed in using the hands, or cleverness in handling situations.",
    ex: "Daily sewing practice greatly improved the dexterity of her fingers.",
    syn: ["skill", "agility", "deftness"] },
  { w: "diligent", ipa: "/ˈdɪl.ɪ.dʒənt/", pos: "adjective",
    def: "Working carefully and with steady, conscientious effort.",
    ex: "Diligent revision throughout the term paid off in his board results.",
    syn: ["hard-working", "industrious", "thorough"] },
  { w: "eloquent", ipa: "/ˈel.ə.kwənt/", pos: "adjective",
    def: "Expressing ideas fluently, clearly and in a persuasive, moving way.",
    ex: "The head boy delivered an eloquent speech on the prize day.",
    syn: ["expressive", "fluent", "articulate"] },
  { w: "empathy", ipa: "/ˈem.pə.θi/", pos: "noun",
    def: "The ability to understand and share another person's feelings.",
    ex: "Good teachers show empathy for students who find a topic difficult.",
    syn: ["compassion", "understanding", "sympathy"] },
  { w: "enigmatic", ipa: "/ˌen.ɪɡˈmæt.ɪk/", pos: "adjective",
    def: "Mysterious and difficult to understand or explain.",
    ex: "The visitor smiled an enigmatic smile and said nothing at all.",
    syn: ["mysterious", "puzzling", "cryptic"] },
  { w: "ephemeral", ipa: "/ɪˈfem.ər.əl/", pos: "adjective",
    def: "Lasting for only a very short time.",
    ex: "Fame on social media is often ephemeral — here today, gone tomorrow.",
    syn: ["fleeting", "short-lived", "transient"] },
  { w: "exemplary", ipa: "/ɪɡˈzem.plər.i/", pos: "adjective",
    def: "So good that it deserves to be copied as an example.",
    ex: "Her exemplary discipline earned her the best-student award.",
    syn: ["model", "commendable", "outstanding"] },
  { w: "fervent", ipa: "/ˈfɜː.vənt/", pos: "adjective",
    def: "Showing very strong and sincere feeling about something.",
    ex: "He is a fervent supporter of the school debate club.",
    syn: ["passionate", "ardent", "earnest"] },
  { w: "fluctuate", ipa: "/ˈflʌk.tʃu.eɪt/", pos: "verb",
    def: "To change frequently and irregularly, rising and falling.",
    ex: "Vegetable prices fluctuate with the seasons in our bazaar.",
    syn: ["waver", "vary", "swing"] },
  { w: "fortitude", ipa: "/ˈfɔː.tɪ.tjuːd/", pos: "noun",
    def: "Courage and strength to endure pain, hardship or difficulty calmly.",
    ex: "She faced the long recovery with quiet fortitude.",
    syn: ["courage", "endurance", "resilience"] },
  { w: "gregarious", ipa: "/ɡrɪˈɡeə.ri.əs/", pos: "adjective",
    def: "Enjoying the company of other people; sociable.",
    ex: "A gregarious student, Ahmed knows everyone in school by name.",
    syn: ["sociable", "outgoing", "friendly"] },
  { w: "guise", ipa: "/ɡaɪz/", pos: "noun",
    def: "An outward appearance or manner that hides the true nature of something.",
    ex: "The remark came in the guise of a joke, but it hurt her feelings.",
    syn: ["pretence", "cover", "mask"] },
  { w: "gratitude", ipa: "/ˈɡræt.ɪ.tjuːd/", pos: "noun",
    def: "The feeling of being thankful and wanting to return kindness.",
    ex: "He expressed gratitude to the teacher who stayed after class to help him.",
    syn: ["thankfulness", "appreciation", "recognition"] },
  { w: "harmony", ipa: "/ˈhɑː.mə.ni/", pos: "noun",
    def: "A state of peaceful agreement, or a pleasing combination of parts.",
    ex: "The whole class worked in perfect harmony to decorate the hall.",
    syn: ["accord", "agreement", "balance"] },
  { w: "hypothesis", ipa: "/haɪˈpɒθ.ə.sɪs/", pos: "noun",
    def: "An idea or explanation put forward as a starting point for testing by study or experiment.",
    ex: "Our hypothesis was proved wrong by the very first experiment.",
    syn: ["theory", "supposition", "premise"] },
  { w: "hypothesize", ipa: "/haɪˈpɒθ.ə.saɪz/", pos: "verb",
    def: "To suggest a possible explanation as a basis for reasoning or investigation.",
    ex: "The students hypothesized that plants grow faster near the window.",
    syn: ["theorize", "speculate", "postulate"] },
  { w: "illuminate", ipa: "/ɪˈluː.mɪ.neɪt/", pos: "verb",
    def: "To light something up, or to make an idea much clearer.",
    ex: "One good diagram can illuminate an idea better than a page of text.",
    syn: ["light up", "clarify", "illustrate"] },
  { w: "impeccable", ipa: "/ɪmˈpek.ə.bəl/", pos: "adjective",
    def: "Perfect, without any mistakes or faults.",
    ex: "His uniform was impeccable on the inspection day.",
    syn: ["flawless", "perfect", "faultless"] },
  { w: "integrity", ipa: "/ɪnˈteɡ.rɪ.ti/", pos: "noun",
    def: "Being honest and holding strong moral principles even when it is difficult.",
    ex: "He returned the lost wallet untouched — a true act of integrity.",
    syn: ["honesty", "honour", "uprightness"] },
  { w: "jargon", ipa: "/ˈdʒɑː.ɡən/", pos: "noun",
    def: "Special words and phrases used by a particular group that others find hard to understand.",
    ex: "The manual was full of technical jargon, so the teacher simplified it for us.",
    syn: ["terminology", "lingo", "wording"] },
  { w: "jubilant", ipa: "/ˈdʒuː.bɪ.lənt/", pos: "adjective",
    def: "Feeling or showing great happiness, especially after a success.",
    ex: "Jubilant students carried the trophy through every corridor of the school.",
    syn: ["overjoyed", "elated", "triumphant"] },
  { w: "juxtapose", ipa: "/ˈdʒʌk.stə.pəʊz/", pos: "verb",
    def: "To place things side by side in order to highlight their differences.",
    ex: "The photo essay juxtaposes the old school building with the new campus.",
    syn: ["contrast", "compare", "set side by side"] },
  { w: "keystone", ipa: "/ˈkiː.stəʊn/", pos: "noun",
    def: "The most important part of something, on which everything else depends.",
    ex: "Regular practice is the keystone of her success in mathematics.",
    syn: ["cornerstone", "foundation", "basis"] },
  { w: "kinship", ipa: "/ˈkɪn.ʃɪp/", pos: "noun",
    def: "A close connection or feeling of being related, by blood or by shared experience.",
    ex: "There is a strong kinship among the school's former students.",
    syn: ["bond", "affinity", "connection"] },
  { w: "kismet", ipa: "/ˈkɪz.met/", pos: "noun",
    def: "Destiny or fate; what is meant to happen.",
    ex: "Running into my childhood friend in Peshawar felt like kismet.",
    syn: ["fate", "destiny", "fortune"] },
  { w: "labyrinth", ipa: "/ˈlæb.ə.rɪnθ/", pos: "noun",
    def: "A place with many complicated paths that is very hard to find your way through.",
    ex: "The old city bazaar is a labyrinth of narrow lanes and hidden shops.",
    syn: ["maze", "tangle", "web"] },
  { w: "levity", ipa: "/ˈlev.ə.ti/", pos: "noun",
    def: "Light-hearted humour, especially when the situation is serious.",
    ex: "A moment of levity eased the tension before the results were announced.",
    syn: ["light-heartedness", "humour", "fun"] },
  { w: "luminous", ipa: "/ˈluː.mɪ.nəs/", pos: "adjective",
    def: "Shining brightly in the dark, or full of light.",
    ex: "The luminous stars on the classroom chart glowed softly at dusk.",
    syn: ["glowing", "radiant", "shining"] },
  { w: "magnanimous", ipa: "/mæɡˈnæn.ɪ.məs/", pos: "adjective",
    def: "Generous and forgiving, especially towards a rival or someone less powerful.",
    ex: "The magnanimous winner praised the very team that had beaten her last year.",
    syn: ["generous", "forgiving", "big-hearted"] },
  { w: "melancholy", ipa: "/ˈmel.ən.kɒl.i/", pos: "noun",
    def: "A feeling of thoughtful sadness, often without a clear cause.",
    ex: "Rainy afternoons always bring a gentle melancholy with them.",
    syn: ["sadness", "gloom", "wistfulness"] },
  { w: "meticulous", ipa: "/məˈtɪk.jə.ləs/", pos: "adjective",
    def: "Extremely careful about small details; very precise.",
    ex: "Meticulous notes made his practical file the model of the class.",
    syn: ["thorough", "precise", "careful"] },
  { w: "mirth", ipa: "/mɜːθ/", pos: "noun",
    def: "Laughter and cheerfulness.",
    ex: "The staff room rang with mirth on the last day before the holidays.",
    syn: ["laughter", "gaiety", "amusement"] },
  { w: "metamorphosis", ipa: "/ˌmet.əˈmɔː.fə.sɪs/", pos: "noun",
    def: "A complete change of form, character or appearance.",
    ex: "The shy new student's metamorphosis into a confident speaker amazed everyone.",
    syn: ["transformation", "conversion", "change"] },
  { w: "noble", ipa: "/ˈnəʊ.bəl/", pos: "adjective",
    def: "Having high moral qualities such as honesty, courage and kindness.",
    ex: "Teaching is a noble profession that shapes every other profession.",
    syn: ["honourable", "virtuous", "dignified"] },
  { w: "nonchalant", ipa: "/ˈnɒn.ʃə.lənt/", pos: "adjective",
    def: "Appearing calm and unconcerned, sometimes carelessly so.",
    ex: "He gave a nonchalant shrug, though the question had completely stumped him.",
    syn: ["casual", "unconcerned", "unbothered"] },
  { w: "nostalgia", ipa: "/nɒˈstæl.dʒə/", pos: "noun",
    def: "A sentimental longing for happy moments in the past.",
    ex: "Walking past the old library filled her with nostalgia.",
    syn: ["wistfulness", "longing", "homesickness"] },
  { w: "nuance", ipa: "/ˈnjuː.ɑːns/", pos: "noun",
    def: "A very small difference in meaning, feeling, colour or sound.",
    ex: "A good reader notices every nuance of a poem's tone.",
    syn: ["subtlety", "shade", "distinction"] },
  { w: "omniscient", ipa: "/ɒmˈnɪs.i.ənt/", pos: "adjective",
    def: "Knowing everything; all-knowing.",
    ex: "The story is told by an omniscient narrator who knows every character's thoughts.",
    syn: ["all-knowing", "all-seeing", "all-wise"] },
  { w: "optimism", ipa: "/ˈɒp.tɪ.mɪ.zəm/", pos: "noun",
    def: "The habit of hoping for the best and believing that things will turn out well.",
    ex: "Her optimism kept the whole team motivated during the difficult weeks.",
    syn: ["hopefulness", "positivity", "confidence"] },
  { w: "orator", ipa: "/ˈɒr.ə.tər/", pos: "noun",
    def: "A skilled and persuasive public speaker.",
    ex: "Quaid-e-Azam was an orator whose words moved millions.",
    syn: ["speaker", "speechmaker", "lecturer"] },
  { w: "oxymoron", ipa: "/ˌɒk.siˈmɔː.rɒn/", pos: "noun",
    def: "A phrase that deliberately puts two contradictory words together for effect.",
    ex: "'Deafening silence' is a classic oxymoron.",
    syn: ["contradiction", "paradox", "contradiction in terms"] },
  { w: "panacea", ipa: "/ˌpæn.əˈsiː.ə/", pos: "noun",
    def: "A supposed cure or solution for every problem or disease.",
    ex: "Technology is no panacea, but it can support a good teacher.",
    syn: ["cure-all", "remedy", "universal fix"] },
  { w: "paradigm", ipa: "/ˈpær.ə.daɪm/", pos: "noun",
    def: "A typical model or pattern of something; a standard way of thinking or doing things.",
    ex: "The smartphone created a new paradigm for how students learn.",
    syn: ["model", "pattern", "exemplar"] },
  { w: "paramount", ipa: "/ˈpær.ə.maʊnt/", pos: "adjective",
    def: "More important than anything else.",
    ex: "Safety is paramount on every school trip.",
    syn: ["supreme", "foremost", "chief"] },
  { w: "paradox", ipa: "/ˈpær.ə.dɒks/", pos: "noun",
    def: "A statement that seems to contradict itself yet may reveal a truth.",
    ex: "The paradox of exams: the less you fear them, the better you perform.",
    syn: ["contradiction", "puzzle", "anomaly"] },
  { w: "perseverance", ipa: "/ˌpɜː.sɪˈvɪə.rəns/", pos: "noun",
    def: "Continued steady effort in spite of difficulties or delays.",
    ex: "Through sheer perseverance she passed the exam on her third attempt.",
    syn: ["persistence", "determination", "grit"] },
  { w: "phenomenon", ipa: "/fəˈnɒm.ɪ.nən/", pos: "noun",
    def: "Something that happens or exists and can be observed, especially something remarkable.",
    ex: "The monsoon is a weather phenomenon every farmer prepares for.",
    syn: ["occurrence", "event", "marvel"] },
  { w: "pragmatic", ipa: "/præɡˈmæt.ɪk/", pos: "adjective",
    def: "Dealing with problems in a practical, realistic way rather than a theoretical one.",
    ex: "A pragmatic timetable leaves room for both study and rest.",
    syn: ["practical", "realistic", "sensible"] },
  { w: "quaint", ipa: "/kweɪnt/", pos: "adjective",
    def: "Charmingly old-fashioned or unusual.",
    ex: "The village's quaint little post office has stood for a century.",
    syn: ["charming", "picturesque", "old-world"] },
  { w: "quintessential", ipa: "/ˌkwɪn.tɪˈsen.ʃəl/", pos: "adjective",
    def: "Being the most perfect or typical example of its kind.",
    ex: "Chapli kebab is the quintessential dish of Peshawar's food street.",
    syn: ["archetypal", "classic", "definitive"] },
  { w: "quintessence", ipa: "/kwɪnˈtes.əns/", pos: "noun",
    def: "The purest and most perfect example of something.",
    ex: "She is the quintessence of patience with the youngest pupils.",
    syn: ["epitome", "essence", "embodiment"] },
  { w: "quizzical", ipa: "/ˈkwɪz.ɪ.kəl/", pos: "adjective",
    def: "Showing mild confusion, surprise or amusement, often with a raised eyebrow.",
    ex: "The teacher gave a quizzical look at the wildly improbable excuse.",
    syn: ["puzzled", "questioning", "curious"] },
  { w: "reciprocal", ipa: "/rɪˈsɪp.rə.kəl/", pos: "adjective",
    def: "Given and received in return; mutual.",
    ex: "The two schools struck a reciprocal arrangement to share their laboratories.",
    syn: ["mutual", "shared", "correlative"] },
  { w: "renaissance", ipa: "/rɪˈneɪ.səns/", pos: "noun",
    def: "A revival or rebirth of interest in art, learning or culture.",
    ex: "The town is enjoying a renaissance of traditional embroidery.",
    syn: ["revival", "rebirth", "renewal"] },
  { w: "resilience", ipa: "/rɪˈzɪl.i.əns/", pos: "noun",
    def: "The ability to recover quickly and strongly from difficulties.",
    ex: "Floods damaged the school, but the students' resilience shone through.",
    syn: ["toughness", "adaptability", "grit"] },
  { w: "retrospect", ipa: "/ˈret.rə.spekt/", pos: "noun",
    def: "Thinking back on past events; 'in retrospect' means when looking back.",
    ex: "In retrospect, the extra week of revision was the best decision we made.",
    syn: ["review", "reconsideration", "hindsight"] },
  { w: "righteous", ipa: "/ˈraɪ.tʃəs/", pos: "adjective",
    def: "Morally right and just; strictly fair.",
    ex: "She felt righteous anger at the unfair marking of the papers.",
    syn: ["virtuous", "just", "upright"] },
  { w: "sagacious", ipa: "/səˈɡeɪ.ʃəs/", pos: "adjective",
    def: "Having good judgement and keen insight, like a wise elder.",
    ex: "The sagacious principal settled the dispute before it could grow.",
    syn: ["wise", "shrewd", "judicious"] },
  { w: "serendipity", ipa: "/ˌsɛr.ənˈdɪp.ɪ.ti/", pos: "noun",
    def: "The happy accident of finding something good or useful while not specifically looking for it.",
    ex: "Finding that hidden waterfall on the school trip was pure serendipity.",
    syn: ["luck", "fluke", "chance"] },
  { w: "solitude", ipa: "/ˈsɒl.ɪ.tjuːd/", pos: "noun",
    def: "The state of being alone, often calmly and by choice.",
    ex: "He finds peaceful solitude on the rooftop with his books after dawn.",
    syn: ["aloneness", "seclusion", "quiet"] },
  { w: "scrutinize", ipa: "/ˈskruː.tɪ.naɪz/", pos: "verb",
    def: "To examine something very closely and critically.",
    ex: "Invigilators scrutinized every answer sheet before the results were sealed.",
    syn: ["examine", "inspect", "study"] },
  { w: "substantiate", ipa: "/səbˈstæn.ʃi.eɪt/", pos: "verb",
    def: "To provide evidence that proves something is true.",
    ex: "The report cited fresh field data to substantiate its findings.",
    syn: ["verify", "prove", "corroborate"] },
  { w: "tangible", ipa: "/ˈtæn.dʒə.bəl/", pos: "adjective",
    def: "Real and solid; clear enough to be touched or measured.",
    ex: "The new laboratory brought tangible improvements in practical scores.",
    syn: ["concrete", "physical", "measurable"] },
  { w: "tenacious", ipa: "/təˈneɪ.ʃəs/", pos: "adjective",
    def: "Holding on firmly; refusing to give up.",
    ex: "Her tenacious defence of the project convinced the judges.",
    syn: ["determined", "persistent", "dogged"] },
  { w: "theorem", ipa: "/ˈθɪə.rəm/", pos: "noun",
    def: "A statement in mathematics that can be proved to be true by logical reasoning.",
    ex: "Pythagoras' theorem links the three sides of every right-angled triangle.",
    syn: ["principle", "law", "proposition"] },
  { w: "transcend", ipa: "/trænˈsend/", pos: "verb",
    def: "To go beyond the usual limits or boundaries of something.",
    ex: "A great teacher's influence transcends the classroom.",
    syn: ["exceed", "surpass", "rise above"] },
  { w: "ubiquitous", ipa: "/juːˈbɪk.wɪ.təs/", pos: "adjective",
    def: "Present or found absolutely everywhere.",
    ex: "Mobile phones have become ubiquitous in our daily lives.",
    syn: ["pervasive", "universal", "everywhere"] },
  { w: "unalloyed", ipa: "/ˌʌn.əˈlɔɪd/", pos: "adjective",
    def: "Pure and complete, without any mixture of anything else (usually of feelings).",
    ex: "Winning the inter-school trophy brought unalloyed joy to the whole school.",
    syn: ["pure", "complete", "utter"] },
  { w: "unequivocal", ipa: "/ˌʌn.ɪˈkwɪv.ə.kəl/", pos: "adjective",
    def: "Completely clear and leaving no doubt whatsoever.",
    ex: "The laboratory result was unequivocal: the drinking water was safe.",
    syn: ["unambiguous", "clear-cut", "unmistakable"] },
  { w: "unprecedented", ipa: "/ʌnˈpres.ɪ.den.tɪd/", pos: "adjective",
    def: "Never having happened or existed before.",
    ex: "The rains brought unprecedented flooding to the district.",
    syn: ["unparalleled", "unheard-of", "exceptional"] },
  { w: "venerate", ipa: "/ˈven.ə.reɪt/", pos: "verb",
    def: "To respect someone or something deeply because of age, wisdom or character.",
    ex: "Students still venerate the school's founding teachers.",
    syn: ["revere", "respect", "honour"] },
  { w: "versatile", ipa: "/ˈvɜː.sə.taɪl/", pos: "adjective",
    def: "Able to adapt to many different activities or be used for many different purposes.",
    ex: "Honey is a versatile ingredient in both food and traditional medicine.",
    syn: ["adaptable", "all-round", "flexible"] },
  { w: "vivacious", ipa: "/vɪˈveɪ.ʃəs/", pos: "adjective",
    def: "Full of life, energy and high spirits.",
    ex: "The vivacious compere kept the audience laughing all evening.",
    syn: ["lively", "spirited", "animated"] },
  { w: "wanderlust", ipa: "/ˈwɒn.də.lʌst/", pos: "noun",
    def: "A strong, restless desire to travel and explore the world.",
    ex: "Her wanderlust has taken her from the valleys of Swat to the peaks of Hunza.",
    syn: ["itchy feet", "restlessness", "love of travel"] },
  { w: "whimsical", ipa: "/ˈwɪm.zɪ.kəl/", pos: "adjective",
    def: "Playfully unusual, fanciful or slightly unpredictable.",
    ex: "The bulletin board featured whimsical doodles of dancing pencils.",
    syn: ["playful", "fanciful", "quirky"] },
  { w: "wisdom", ipa: "/ˈwɪz.dəm/", pos: "noun",
    def: "The ability to use knowledge and experience to make good decisions and judgements.",
    ex: "The village elder's wisdom settled a quarrel that had lasted years.",
    syn: ["insight", "sagacity", "judgement"] },
  { w: "xenial", ipa: "/ˈziː.ni.əl/", pos: "adjective",
    def: "Relating to hospitality, especially the friendly bond between host and guest.",
    ex: "Pakhtun culture is famous for its xenial traditions of welcoming guests.",
    syn: ["hospitable", "welcoming", "friendly"] },
  { w: "yearning", ipa: "/ˈjɜː.nɪŋ/", pos: "noun",
    def: "A deep, persistent longing for something or someone.",
    ex: "A yearning for home filled him during his first semester away.",
    syn: ["longing", "craving", "desire"] },
  { w: "zealous", ipa: "/ˈzel.əs/", pos: "adjective",
    def: "Showing great energy and enthusiasm for a cause or a goal.",
    ex: "Zealous volunteers cleaned the entire playground before sunrise.",
    syn: ["passionate", "fervent", "enthusiastic"] },
  { w: "zenith", ipa: "/ˈzen.ɪθ/", pos: "noun",
    def: "The highest point or peak of success, power or happiness.",
    ex: "The school band reached its zenith at the national festival.",
    syn: ["peak", "summit", "apex"] },
];

// ── Date helpers ─────────────────────────────────────────────────────
// Pakistan Standard Time helper (UTC+5). The school is in Mohmand, KPK.
// We key the daily rotation on the PKT date so "today" matches what visitors
// see on the homepage regardless of where the serverless function runs.
function todayKeyPKT() {
  const pktString = new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" });
  const d = new Date(pktString);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Seeded PRNG so the selected word is stable for a given date, but changes
// automatically at midnight PKT.
function seededRandom(key) {
  let seed = 0;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0;
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Build today's entry from the embedded dataset ────────────────────
// Deterministic: same PKT date → same word for every visitor, zero network
// calls, zero latency, zero failure modes. Normalises both entry shapes
// (flat single-sense entries and multi-`senses` entries) into the exact
// response shape the homepage component has always consumed.
function buildEntryForDate(dateKey) {
  const rand = seededRandom(dateKey + "-curated");
  const idx = Math.floor(rand() * WORD_ENTRIES.length);
  const e = WORD_ENTRIES[idx];

  const senses = Array.isArray(e.senses) && e.senses.length > 0
    ? e.senses
    : [{ ipa: e.ipa, pos: e.pos, def: e.def, ex: e.ex, syn: e.syn }];

  return {
    ok: true,
    word: e.w,
    phonetics: [{ text: senses[0].ipa || "", audio: "" }],
    meanings: senses.map((s) => ({
      partOfSpeech: s.pos || "general",
      definitions: [{
        definition: s.def || "",
        example: s.ex || "",
        synonyms: Array.isArray(s.syn) ? s.syn : [],
      }],
    })),
    source: "curated-offline",
    date: dateKey,
  };
}

// ── HTTP handler ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS — same-origin in production, but allow * for dev tools and for
  // direct testing. Safe because the response is a public word+definition.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ── Sub-route: ?word=<anything> → ad-hoc definition lookup (best effort)
  // Used by the homepage "double-click any word to see its definition"
  // popup. This path still needs the online Free Dictionary API because the
  // popup can request arbitrary words; it fails gracefully with 404 when
  // the upstream is unreachable (the popup then shows "No definition
  // found") and never affects the Word-of-the-Day card itself.
  const rawWord = (req.query && (req.query.word || req.query.w)) || "";
  if (typeof rawWord === "string" && rawWord.trim().length > 0) {
    return handleWordLookup(req, res, rawWord.trim());
  }

  // ── Word of the Day — served from the embedded dataset ──────────────
  // No upstream calls, no in-memory cache needed (generation is instant),
  // CDN-cached for an hour and revalidated for the rest of the day.
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=3600, stale-while-revalidate=82800"
  );

  try {
    const payload = buildEntryForDate(todayKeyPKT());
    return res.status(200).json(payload);
  } catch (err) {
    // Purely defensive — buildEntryForDate() cannot perform I/O, so this
    // branch is unreachable in practice. Kept so the endpoint can never
    // crash the function no matter what.
    console.error("[word-of-day] unexpected failure:", err && err.message);
    return res.status(500).json({
      ok: false,
      error: "Could not load today's word. Please check your connection.",
      detail: String((err && err.message) || err),
    });
  }
}

// ── Sub-handler: arbitrary word definition lookup (for the popup) ────
// Best-effort ONLINE lookup via the Free Dictionary API. Cached per word
// for 24 h. Gracefully degrades to 404 when the upstream is unreachable —
// this ONLY affects the double-click popup, never the Word-of-the-Day card.
const wordCache = new Map(); // word -> { payload, expiresAt }
const WORD_TTL_MS = 24 * 60 * 60 * 1000;

function getCachedWord(w) {
  const e = wordCache.get(w);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    wordCache.delete(w);
    return null;
  }
  return e.payload;
}
function setCachedWord(w, payload) {
  wordCache.set(w, { payload, expiresAt: Date.now() + WORD_TTL_MS });
}

// Lightweight fetch wrapper with timeout and helpful error messages.
async function fetchJSON(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`${label} returned HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`${label} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw new Error(`${label} failed: ${err.message || err}`);
  } finally {
    clearTimeout(timer);
  }
}

// Free Dictionary API lookup for a known word → same entry shape as above.
async function fetchFromDictionary(word) {
  const data = await fetchJSON(DICT_URL(word), "Dictionary");
  if (!Array.isArray(data) || !data[0]) {
    throw new Error("Dictionary returned no entry");
  }
  const entry = data[0];
  const w = (entry.word || word || "").toString().trim().toLowerCase();
  if (!w) throw new Error("Dictionary entry had no word");

  // Filter out meanings with no definitions
  const meanings = (entry.meanings || [])
    .filter((m) => Array.isArray(m.definitions) && m.definitions.length > 0)
    .map((m) => ({
      partOfSpeech: m.partOfSpeech || "general",
      definitions: m.definitions.map((d) => ({
        definition: d.definition || "",
        example: d.example || "",
        synonyms: Array.isArray(d.synonyms) ? d.synonyms : [],
      })),
    }));

  if (meanings.length === 0) {
    throw new Error("Dictionary entry had no usable meanings");
  }

  // Build the `phonetics` array the frontend expects.
  const phonetics = [];
  if (entry.phonetic) phonetics.push({ text: entry.phonetic, audio: "" });
  if (Array.isArray(entry.phonetics)) {
    for (const p of entry.phonetics) {
      if (p && (p.text || p.audio)) phonetics.push(p);
    }
  }

  return { word: w, phonetics, meanings, source: "dictionaryapi.dev" };
}

async function handleWordLookup(req, res, word) {
  // Reject anything that isn't a simple alphabetic word (plus hyphen /
  // apostrophe for things like "well-known" / "it's"). Defends against
  // SSRF-via-query-string abuse and keeps the URL clean.
  const clean = word.replace(/[^a-zA-Z'\-]/g, "").slice(0, 40);
  if (!clean) {
    return res.status(400).json({ ok: false, error: "Invalid word" });
  }
  const key = clean.toLowerCase();

  // 24h server cache for repeated lookups of the same word
  const cached = getCachedWord(key);
  if (cached) {
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=86400, stale-while-revalidate=604800"
    );
    return res.status(200).json(cached);
  }

  try {
    const entry = await fetchFromDictionary(key);
    const payload = { ok: true, ...entry };
    setCachedWord(key, payload);
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=86400, stale-while-revalidate=604800"
    );
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(404).json({
      ok: false,
      error: `No definition found for "${key}".`,
      detail: err.message || String(err),
    });
  }
}
