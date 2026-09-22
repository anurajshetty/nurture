/**
 * The 40-week content matrix — the source of truth for Home v1.1.
 *
 * One curated row per gestational week (4–42). Human-reviewed; the LLM
 * never invents facts, it only phrases what's here. See
 * HOME_ROADMAP_PROPOSAL.md §2 for the full design.
 *
 * CURATION (Anuraj, Sept 2026): weeks 4–42 are fully curated (weeks
 * 4–35 approved Sept 20, 2026); weeks 1–3 still use FALLBACK_ROW — safe,
 * generic, general-info copy. The engine degrades gracefully:
 * `getMatrixRow()` never returns undefined.
 *
 * Content rules (non-negotiable):
 * - General information only. "Many people…" / "usually…" posture.
 * - Never "you should/shouldn't". Never risk rates, never warning-sign
 *   lists — those belong in a doctor's office.
 * - Prep windows are suggestions, not deadlines. Copy must survive being
 *   read at 2 AM without raising a heartbeat.
 * - Experienced-mom variants go DEEPER/different — never repeat 101 info.
 */

import type { AgeBandValue } from './context';
import type { RotatingKind } from './delight';

/**
 * Content review date (YYYY-MM-DD) shown in the Home footer.
 * The matrix is human-curated; clinician review is still pending —
 * never describe this content as clinician-reviewed.
 */
export const MATRIX_REVIEW_DATE = '2026-09-20';

/** A milestone touching this week (this week = offset 0, next = +1). */
export interface MatrixMilestone {
  id: string;
  label: string;
  weekOffset: 0 | 1;
  tone: 'celebrate' | 'prepare' | 'inform';
  /** Curated, warm, general-info only. */
  copy: string;
}

/** A prep window — "many people…" posture, never "you must". */
export interface MatrixPrep {
  id: string;
  /** Active weeks, inclusive, e.g. [34, 36]. */
  window: [number, number];
  copy: string;
  deepLink?: 'plan' | 'logs';
}

export interface WeekMatrixRow {
  week: number;
  anchors: {
    /** One developmental headline, curated. */
    baby: string;
    /** One maternal headline, curated. */
    body: string;
  };
  milestones: MatrixMilestone[];
  prep: MatrixPrep[];
  /** One warm line teasing next week (Anuraj: Home shows this week + a taste of next). */
  nextWeekTeaser?: string;
  delight: {
    /** Fact-bank ids the engine prefers this week (see delight.ts FACTS). */
    factIds: string[];
    /** Rotating kinds to prefer this week. */
    rotatingBoost?: RotatingKind[];
    /** 2–3 one-line angles the LLM may riff on. */
    freshAngles: string[];
  };
  /** Seeds for the 4 routine cards — the LLM phrases, never invents. */
  routineSeeds: {
    baby: string[];
    body: string[];
    know: string[];
    tips: string[];
  };
  /** First-time framing: orientation (what things are). */
  firstTimeNote?: string;
  /**
   * Experienced framing: DEEPER/different — second-time-around angles,
   * subtler milestones. Never the 101 version.
   */
  experiencedNote?: string;
  ageBandNotes?: Partial<Record<AgeBandValue, string>>;
  quietDay: {
    /** May show the look-back teaser on quiet days (3–7). */
    lookbackEligible: boolean;
  };
}

/* ------------------------------------------------------------------ */
/* Approved prep windows (Anuraj, Sept 2026 — approved as proposed).    */
/* Shared across curated rows; the engine filters by active week.       */
/* ------------------------------------------------------------------ */

const PREP_HOSPITAL_BAG: MatrixPrep = {
  id: 'hospital-bag',
  window: [34, 36],
  copy: 'Many pack a hospital bag around now — a gentle checklist lives in Plan.',
  deepLink: 'plan',
};

const PREP_BIRTH_PLAN: MatrixPrep = {
  id: 'birth-plan',
  window: [32, 36],
  copy: 'If a birth plan is on your mind, many people jot down a few preferences around now — wishes, not rules.',
  deepLink: 'plan',
};

const PREP_PEDIATRICIAN: MatrixPrep = {
  id: 'pediatrician',
  window: [34, 42],
  copy: 'Many families pick a pediatrician in these last weeks — one less thing to think about later.',
};

const PREP_CAR_SEAT: MatrixPrep = {
  id: 'car-seat',
  window: [36, 42],
  copy: 'The car seat can go in any time — many install it now, one less thing.',
};

const LATE_PREP = [PREP_PEDIATRICIAN, PREP_CAR_SEAT];

/* ------------------------------------------------------------------ */
/* Curated rows: weeks 4–35 (Anuraj approved Sept 20, 2026).            */
/* Integrated from willow-content/drafts/rows-{04-13,14-23,24-35}.ts      */
/* with rotatingBoost normalized to RotatingKind[] and prep ID strings   */
/* mapped to the approved MatrixPrep constants above. Content as         */
/* drafted — general information only; clinician review still pending.    */
/* ------------------------------------------------------------------ */

const ROW_4: WeekMatrixRow = {
  week: 4,
  anchors: {
    baby: 'Implantation week — {name} is a tiny ball of cells called a blastocyst, settling into the uterine lining.',
    body: 'A missed period is often the first clue, and a home pregnancy test may turn positive around now.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: the embryo\u2019s three layers get to work \u2014 the beginnings of brain, heart, and gut.',
  delight: {
    factIds: [],
    freshAngles: ['The quietest big week', 'Settling in'],
  },
  routineSeeds: {
    baby: [
      'This week the blastocyst burrows into the uterine lining \u2014 a process called implantation.',
      'Inside it, the inner cells will become the embryo, while the outer layer starts forming part of the placenta.',
      'The neural tube \u2014 the earliest framework of the brain and spinal cord \u2014 begins taking shape.',
    ],
    body: [
      'A missed period is usually the first signal of pregnancy, though with irregular cycles it can be easy to overlook.',
      'A home pregnancy test can turn positive around now \u2014 most detect the pregnancy hormone about 9 to 12 days after conception.',
      'Many people feel completely normal at this point. This early on, symptoms vary enormously from person to person.',
    ],
    know: [
      'Pregnancy is counted from the first day of the last menstrual period \u2014 so "week 4" is only about two weeks after conception.',
      'Folate gets a lot of attention in these earliest weeks: it\u2019s the B vitamin linked to healthy neural tube development, and many prenatal vitamins include it.',
    ],
    tips: [
      'Jot down the first day of the last period \u2014 it\u2019s the date every due-date calculation starts from.',
      'If a home test is on the agenda, testing around the time of the missed period tends to give the clearest answer.',
      'Rest without guilt. The body is doing intricate, invisible work this week.',
    ],
  },
  firstTimeNote:
    'The dating sounds odd, but everyone counts the same way: the two weeks before conception count as weeks 1 and 2 of pregnancy.',
  experiencedNote:
    'You\u2019ve done this strange math before \u2014 weeks counted before anything happened. The waiting-for-the-test stretch may feel shorter this time, or exactly as long; either way, it counts.',
  quietDay: { lookbackEligible: true },
};

const ROW_5: WeekMatrixRow = {
  week: 5,
  anchors: {
    baby: 'This week {name} becomes an embryo \u2014 three layers of cells laying the groundwork for everything to come.',
    body: 'Pregnancy hormones are climbing fast now. Fatigue, tender breasts, or extra bathroom trips may appear \u2014 or nothing at all.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: the neural tube closes, the tiny heart takes shape, and arm buds appear.',
  delight: {
    factIds: [],
    freshAngles: ['Three layers, one blueprint', 'The hormone surge'],
  },
  routineSeeds: {
    baby: [
      'The embryo is now made of three layers: one becomes skin and the nervous system, one becomes the heart and circulation, one becomes the lungs and gut.',
      'The heart and a primitive circulatory system are forming in the middle layer \u2014 the beginnings of a heartbeat.',
      'The pregnancy hormone hCG is rising quickly, telling the ovaries to pause and fueling the placenta\u2019s growth.',
    ],
    body: [
      'Rising hormones can bring deep fatigue, sore breasts, or more frequent bathroom trips \u2014 all common, and all optional.',
      'Nausea often begins around now, though for many people it\u2019s still a week or two away.',
      'It\u2019s also completely normal to feel nothing yet. Early symptoms vary enormously from person to person.',
    ],
    know: [
      'The blastocyst chapter is over \u2014 from week 5 through week 8, the baby is called an embryo.',
      'Rising hCG is what home pregnancy tests detect, and levels climb fast this week.',
    ],
    tips: [
      'Keep water and a small snack within reach \u2014 queasiness often arrives unannounced.',
      'Go to bed early without apology. Growing the placenta is genuinely exhausting work.',
      'Start a running list of questions for the first prenatal visit \u2014 the small ones count too.',
    ],
  },
  firstTimeNote:
    'Week 5 is often the "is this real?" week \u2014 the positive test is fresh and the embryo is only a couple of millimeters long. It\u2019s real; it\u2019s just very, very small.',
  experiencedNote:
    'You know how the early weeks go \u2014 the tiredness, the watching and waiting. But this embryo carries an entirely new blueprint. Same beginning, different person.',
  quietDay: { lookbackEligible: true },
};

const ROW_6: WeekMatrixRow = {
  week: 6,
  anchors: {
    baby: 'The neural tube is closing this week \u2014 the structure that becomes {name}\u2019s brain and spinal cord \u2014 and the tiny heart is forming.',
    body: 'Nausea often ramps up around now. It usually peaks somewhere in weeks 6 to 10, then eases \u2014 for many, the worst is temporary.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: the head takes shape \u2014 nostrils appear, retinas begin, and arm buds flatten into paddles.',
  delight: {
    factIds: [],
    freshAngles: ['The neural tube closes', 'A flicker on the ultrasound'],
  },
  routineSeeds: {
    baby: [
      'The neural tube along the baby\u2019s back is closing \u2014 the brain and spinal cord develop from it.',
      'The heart and other organs are starting to form, and its rhythmic pulsing can sometimes be seen on an early ultrasound.',
      'Small buds appear that will become arms, the body takes on a C-shaped curve, and the structures for eyes and ears develop.',
    ],
    body: [
      'Queasiness often intensifies this week \u2014 many people find small, frequent snacks easier than full meals.',
      'Fatigue can feel bone-deep right now. Rest is doing something, not nothing.',
      'Tender breasts and a heightened sense of smell are common companions in these weeks.',
    ],
    know: [
      'The neural tube\u2019s closing window is why folate gets so much attention in early pregnancy \u2014 most prenatal vitamins include it.',
      'Week 6 is roughly the halfway mark of the first trimester, even though it can feel like the very beginning.',
    ],
    tips: [
      'Many people keep plain crackers or ginger tea nearby for queasy moments.',
      'Fresh air helps when smells turn overwhelming \u2014 a short walk or an open window.',
      'Keep writing down questions as they come; the first prenatal visit (often around week 8) arrives fast.',
    ],
  },
  firstTimeNote:
    'Week 6 is when it can feel real and unreal at once \u2014 the embryo is tiny, but the nausea is full-sized. Both are normal.',
  experiencedNote:
    'If last time the nausea arrived like clockwork at week 6, you may be bracing \u2014 but every pregnancy writes its own schedule. Notice what\u2019s different this time; the differences are the story.',
  quietDay: { lookbackEligible: true },
};

const ROW_7: WeekMatrixRow = {
  week: 7,
  anchors: {
    baby: 'Brain and face are the focus this week \u2014 nostrils appear, the retinas begin to form, and {name}\u2019s arm buds flatten into paddles.',
    body: 'Exhaustion can peak around now. The placenta is under heavy construction, and that invisible work is genuinely tiring.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: fingers begin to form, and the nose and upper lip take shape.',
  delight: {
    factIds: [],
    freshAngles: ['A face taking shape', 'The tiredest week'],
  },
  routineSeeds: {
    baby: [
      'The brain and face are growing fast \u2014 depressions that will become the nostrils are now visible.',
      'The very beginnings of the retinas are forming, and lower limb buds appear that will become legs.',
      'The arm buds that sprouted last week now flatten into paddle shapes \u2014 the earliest hands.',
    ],
    body: [
      'Deep fatigue is the headline symptom for many this week \u2014 naps are a strategy, not a luxury.',
      'Food aversions may get oddly specific. Eating the few things that appeal is a fine plan for now.',
      'Mood swings are common \u2014 the hormones are loud, and so is the life change.',
    ],
    know: [
      'The embryo still has a small tail-like curve \u2014 completely normal, and it disappears in the next week or two.',
      'A tiny yolk sac is still helping with nourishment while the placenta finishes forming.',
    ],
    tips: [
      'Eat what sounds good, when it sounds good. Variety can wait for the second trimester.',
      'Keep the bedroom cool and dark for daytime naps \u2014 sleep is doing double duty.',
      'Tell one trusted person, if you haven\u2019t \u2014 carrying the secret alone is its own kind of tired.',
    ],
  },
  firstTimeNote:
    'The tail-like curve in diagrams alarms every first-timer \u2014 it\u2019s simply how every human starts out, and it\u2019s already on its way out.',
  experiencedNote:
    'With a little one already in tow, week-7 exhaustion hits different \u2014 the same embryo-building fatigue, plus a toddler. Lower the bar; the bar understands.',
  quietDay: { lookbackEligible: true },
};

const ROW_8: WeekMatrixRow = {
  week: 8,
  anchors: {
    baby: 'Fingers have begun to form, the nose and upper lip are in place \u2014 {name} is about half an inch long and looking more baby-like by the day.',
    body: 'Many people have their first prenatal visit around now, usually somewhere between weeks 8 and 10.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: elbows appear, toes become visible, and eyelids form.',
  delight: {
    factIds: [],
    freshAngles: ['Fingers, nose, and a first appointment', 'Half an inch of person'],
  },
  routineSeeds: {
    baby: [
      'Fingers have begun to form, and small swellings outline the future shape of the ears.',
      'The eyes are becoming noticeable, the upper lip and nose have formed, and the trunk and neck begin to straighten.',
      'By the end of this week the baby measures about half an inch from crown to rump.',
    ],
    body: [
      'The first prenatal visit is often the longest \u2014 mostly conversation, history, and planning. A questions list comes in handy.',
      'Nausea is often in its peak stretch now; for many people, relief begins in the next couple of weeks.',
      'Emotions can swing from excitement to anxiety and back again \u2014 both are part of the package.',
    ],
    know: [
      'By the end of this week, the foundations of all the major organs are in place \u2014 from here, it\u2019s largely growth and refinement.',
      'Bring the date of the last period to the first appointment \u2014 it anchors all the dating math.',
    ],
    tips: [
      'Write down every question, even the small ones \u2014 appointments go fast and memory goes fuzzy.',
      'If queasiness rules the day, bland and frequent beats ambitious and rare.',
      'Comfortable waistbands start earning their keep around now.',
    ],
  },
  firstTimeNote:
    'The first appointment can feel like a big event \u2014 in practice it\u2019s a long conversation with some planning. Bring your questions and your last-period date.',
  experiencedNote:
    'You know the first-visit drill \u2014 the family history, the dating math. This time, notice what\u2019s changed: guidelines evolve, providers differ, and so do you.',
  quietDay: { lookbackEligible: true },
};

const ROW_9: WeekMatrixRow = {
  week: 9,
  anchors: {
    baby: 'Elbows appear this week, toes become visible, and eyelids form \u2014 {name}\u2019s arms are growing longer every day.',
    body: 'Cravings and aversions often get very specific now \u2014 yesterday\u2019s favorite dinner can become today\u2019s no-way.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: the elbows bend, and fingers and toes lose their webbing.',
  delight: {
    factIds: [],
    freshAngles: ['Elbows and eyelids', 'The very specific aversions'],
  },
  routineSeeds: {
    baby: [
      'The arms are growing, elbows appear, toes are visible, and eyelids form.',
      'The head is still large in proportion to the body, with a softly formed chin.',
      'The little tail-like curve of earlier weeks has disappeared.',
    ],
    body: [
      'Strong food aversions are hormonal, not pickiness \u2014 honoring them is a perfectly good strategy.',
      'Nausea often continues through this week; the peak window is usually weeks 6 to 10.',
      'Mood swings may surprise you \u2014 fluctuating hormones can turn the volume up on every feeling.',
    ],
    know: [
      'The eyelids forming now will stay fused shut for many more weeks \u2014 they\u2019re built early and opened late.',
      'At just under three-quarters of an inch long, the baby is doing an enormous amount of developing in a very small package.',
    ],
    tips: [
      'Stock the foods that currently sound safe \u2014 tastes may change again next week.',
      'Small sips of cold water through the day help many people feel steadier.',
      'A short daily walk, when energy allows, can lift both mood and nausea.',
    ],
  },
  firstTimeNote:
    'Aversions aren\u2019t fussiness \u2014 they\u2019re chemistry. Eating the same five safe foods on repeat is a legitimate week-9 meal plan.',
  experiencedNote:
    'If last time you survived on toast until week 14, you know this drill \u2014 though the "safe foods" list is rarely the same twice. New pregnancy, new menu.',
  quietDay: { lookbackEligible: true },
};

const ROW_10: WeekMatrixRow = {
  week: 10,
  anchors: {
    baby: 'The elbows can bend now, and tiny fingers and toes are losing their webbing \u2014 {name} is stretching in miniature.',
    body: 'For many, the nausea fog starts lifting around now. Energy often returns gradually over the coming weeks.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: tooth buds appear, and red blood cells begin forming in the liver.',
  delight: {
    factIds: [],
    freshAngles: ['Bendable elbows', 'The fog begins to lift'],
  },
  routineSeeds: {
    baby: [
      'The head has become rounder, and the elbows can now bend.',
      'Toes and fingers are losing their webbing and becoming longer.',
      'The eyelids and the outer parts of the ears continue to develop.',
    ],
    body: [
      'Queasiness often loosens its grip this week \u2014 though for some it lingers, and that\u2019s within normal too.',
      'Slower digestion can bring bloating or constipation \u2014 very common companions in these weeks.',
      'Some people notice the mental fog lifting slightly, in waves rather than all at once.',
    ],
    know: [
      'The busiest construction phase is nearly behind you \u2014 from here, development is largely growth and refinement.',
      'There\u2019s no "right" time to share the news \u2014 ten weeks is simply when many people start telling wider circles.',
    ],
    tips: [
      'As appetite returns, reintroduce variety gently \u2014 no need to make up for lost meals.',
      'Keep the rest habit even as energy returns \u2014 recovery arrives in waves, not all at once.',
      'A short daily walk helps many people feel more like themselves again.',
    ],
  },
  firstTimeNote:
    'Week 10 is a quiet turning point \u2014 the baby\u2019s critical building phase is nearly done, and the second trimester is suddenly close enough to picture.',
  experiencedNote:
    'It\u2019s tempting to compare this week 10 to last time\u2019s \u2014 try to let this pregnancy be its own story. The milestones rhyme; they don\u2019t repeat.',
  quietDay: { lookbackEligible: true },
};

const ROW_11: WeekMatrixRow = {
  week: 11,
  anchors: {
    baby: 'Tooth buds appear under the gums, red blood cells begin forming in the liver \u2014 and {name}\u2019s face is taking on a broader, more familiar shape.',
    body: 'Nausea often starts fading now, and the first-trimester screening window (around weeks 11 to 14) is open.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: the first trimester ends \u2014 fingernails sprout and reflexes wake up.',
  delight: {
    factIds: [],
    freshAngles: ['Tooth buds and red blood cells', 'The screening conversation'],
  },
  routineSeeds: {
    baby: [
      'Buds for future teeth appear, and red blood cells are beginning to form in the liver.',
      'The face is broad, the eyes widely separated, the eyelids fused, and the ears set low on the sides of the head.',
      'By now the baby measures about 2 inches long and weighs around a third of an ounce.',
    ],
    body: [
      'For many, the worst of the nausea is passing \u2014 appetite often creeps back in stages.',
      'First-trimester screening is optional and usually offered around now \u2014 there\u2019s no rush to decide.',
      'Tiny movements are happening in there, though feeling them is still many weeks away.',
    ],
    know: [
      'Screening conversations usually start with options, not answers \u2014 questions are welcome and expected.',
      'The baby\u2019s eyelids are fused shut and will stay that way for months \u2014 they open much later in pregnancy.',
    ],
    tips: [
      'If screening is offered, take the information home if you like \u2014 decisions don\u2019t need to happen in the appointment.',
      'Celebrate small wins: a food staying down, a full night\u2019s sleep, a walk that felt good.',
      'Keep water close \u2014 it helps with the headaches and sluggish digestion many people notice.',
    ],
  },
  firstTimeNote:
    'Eleven weeks is when many people start feeling cautiously optimistic \u2014 the hardest weeks are usually behind you, and the bump is still a happy secret.',
  experiencedNote:
    'Second time around, week 11 can feel like familiar territory \u2014 same waiting room, different baby. Let yourself be a beginner at this one too.',
  quietDay: { lookbackEligible: true },
};

const ROW_12: WeekMatrixRow = {
  week: 12,
  anchors: {
    baby: '{Name} is sprouting fingernails, and their reflexes are waking up \u2014 fingers curl, toes flex, tiny sucking motions begin.',
    body: 'For many, the nausea fog is lifting \u2014 appetite and energy often start returning now.',
  },
  milestones: [
    {
      id: 'end-first-trimester',
      label: 'End of the first trimester',
      weekOffset: 0 as const,
      tone: 'celebrate',
      copy: 'Twelve weeks \u2014 the trimester of fastest, most intricate development is complete. The busiest building is behind you.',
    },
  ],
  prep: [],
  nextWeekTeaser: 'Next week: the second trimester begins \u2014 bones start to harden and everything gets roomier.',
  delight: {
    factIds: ['heartbeat-fast', 'placenta', 'lanugo'],
    freshAngles: ['The trimester turns', 'Reflexes wake up', 'Celebrating twelve weeks'],
  },
  routineSeeds: {
    baby: [
      'Fingernails are sprouting, and the face has taken on a more developed profile.',
      'The intestines have moved into the abdomen, where they\u2019ll stay.',
      'Reflexes are waking up \u2014 fingers open and close, toes curl, and tiny sucking motions begin.',
    ],
    body: [
      'Nausea often eases this week \u2014 many people describe it as a fog lifting.',
      'Energy and appetite frequently return in stages, not all at once.',
      'The first-trimester screening window (around weeks 11 to 14) is still open, if it\u2019s something you\u2019re considering.',
    ],
    know: [
      'Twelve weeks marks the end of the first trimester \u2014 the trimester when development is fastest and most intricate.',
      'From here, the baby\u2019s main job is growth \u2014 the intricate wiring is largely laid.',
    ],
    tips: [
      'Mark the milestone somehow \u2014 many people do something small to celebrate twelve weeks.',
      'If appetite is back, eat the rainbow \u2014 no need to be perfect about it.',
      'Keep resting when tired \u2014 the second-trimester energy boost arrives gradually.',
    ],
  },
  firstTimeNote:
    'Twelve weeks is the milestone many people have been quietly counting toward \u2014 the end of the first trimester. It deserves a deep breath.',
  experiencedNote:
    'You know week 12 isn\u2019t a finish line, just a bend in the road \u2014 but bends are worth marking too. This baby\u2019s story is only beginning.',
  quietDay: { lookbackEligible: true },
};

const ROW_13: WeekMatrixRow = {
  week: 13,
  anchors: {
    baby: 'Welcome to the second trimester \u2014 {name}\u2019s bones are starting to harden, and their paper-thin skin will soon thicken.',
    body: 'Many people turn a corner now \u2014 less nausea, more energy, and the news often starts to travel.',
  },
  milestones: [
    {
      id: 'second-trimester',
      label: 'Second trimester begins',
      weekOffset: 0 as const,
      tone: 'celebrate',
      copy: 'Thirteen weeks \u2014 the second trimester is here. Often the most comfortable stretch of pregnancy.',
    },
  ],
  prep: [],
  nextWeekTeaser: 'Next week: the second trimester settles in \u2014 and many people start feeling more like themselves.',
  delight: {
    factIds: ['skull-soft', 'swallowing-practice', 'blood-type-bones'],
    freshAngles: ['The sweet spot begins', 'Bones hardening', 'News travels'],
  },
  routineSeeds: {
    baby: [
      'Bones are starting to harden in the skeleton \u2014 especially in the skull and the long bones of the arms and legs.',
      'The skin is still thin and transparent, but it will start getting thicker soon.',
      'The intestines have moved into the abdomen, and the head can move now.',
    ],
    body: [
      'Many people report feeling better as the second trimester begins \u2014 the "golden period," as some call it.',
      'The uterus is expanding upward out of the pelvis \u2014 some people notice their waistline changing.',
      'Energy often returns in a rush, then evens out. Pace yourself anyway.',
    ],
    know: [
      'The second trimester runs from week 13 to week 26 \u2014 the middle third of pregnancy.',
      'The first flutters of movement are usually still weeks away \u2014 most people notice them between weeks 16 and 24.',
    ],
    tips: [
      'Many people share their news around now \u2014 there\u2019s no script, just your own words.',
      'Gentle movement feels good to many people now \u2014 walks, swimming, or prenatal yoga.',
      'Keep the questions list going \u2014 the next appointment is a fine time for the ones that can wait.',
    ],
  },
  firstTimeNote:
    'Thirteen weeks: the trimester everyone calls the sweet spot begins. The hardest part of the beginning is behind you.',
  experiencedNote:
    'The second trimester with a toddler in tow is a different sport \u2014 the energy comes back, but so does the juggling. Savor the easier weeks; you\u2019ve earned them.',
  quietDay: { lookbackEligible: true },
};

const ROW_14: WeekMatrixRow = {
  week: 14,
  anchors: {
    baby: '{Name} is officially a second-trimester baby. Their neck is lengthening and their body is catching up to their head.',
    body: 'Energy often starts returning now — the fog of the first trimester lifting, a little at a time.',
  },
  milestones: [
    {
      id: 'second-trimester',
      label: 'Second trimester',
      weekOffset: 0,
      tone: 'inform',
      copy: 'Welcome to the second trimester — for many, the steadiest and most comfortable stretch.',
    },
  ],
  prep: [],
  nextWeekTeaser: 'Next week: their legs outgrow their arms — and their taste buds switch on.',
  delight: {
    factIds: ['lanugo', 'swallowing-practice', 'heartbeat-fast'],
    freshAngles: ['The second-trimester turn', 'Energy on its way back', 'A downy first coat'],
  },
  routineSeeds: {
    baby: [
      'Their neck is more defined now, and their body is growing faster than their head.',
      'Fine downy lanugo is starting to cover their skin — it will help the vernix stick later on.',
      'Their spleen is beginning to make red blood cells, and their heart beats on strongly.',
    ],
    body: [
      'Energy often starts coming back now — many people feel the first-trimester fog lifting.',
      'A small bump may be appearing, or may still be a while away. Both are completely usual.',
      'Nausea often eases around now for many people.',
    ],
    know: [
      'Week 14 opens the second trimester — often called the steadiest stretch of pregnancy.',
      'Most of the essential building is done; from here the work is growing and refining.',
    ],
    tips: [
      'Many people bridge the in-between weeks with a belly band or borrowed waistbands.',
      'If food is appealing again, regular small meals keep energy steadier.',
      'Even as energy returns, many people keep protecting their rest — growing a person is still the full-time job.',
    ],
  },
  firstTimeNote:
    'Week 14 is when many people turn the corner — the queasy, exhausted first trimester is behind you, and the steadier middle stretch begins.',
  experiencedNote:
    'You know the energy may or may not return on schedule — this pregnancy gets its own timeline, not your last one.',
  quietDay: { lookbackEligible: true },
};

const ROW_15: WeekMatrixRow = {
  week: 15,
  anchors: {
    baby: '{Name}\'s legs have grown longer than their arms — the proportions are evening out, and they\'re looking more like a newborn in miniature.',
    body: 'Many feel more like themselves this week — steadier days, and a bump that may be quietly appearing.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: their eyes start practicing their moves.',
  delight: {
    factIds: ['flavors-amniotic', 'swallowing-practice', 'hiccups'],
    freshAngles: ['Proportions evening out', 'Tasting the world already', 'Light through closed lids'],
  },
  routineSeeds: {
    baby: [
      'Their legs have grown longer than their arms — the body proportions are evening out.',
      'Taste buds are forming, and they can already sense light through their closed eyelids.',
      'They\'re inhaling amniotic fluid — breathing practice for their little lungs.',
    ],
    body: [
      'Many feel more like themselves this week — energy up, steadier days.',
      'The bump may be quietly visible now, though it still hides easily some days.',
      'Nasal stuffiness and tender gums are common as blood flow increases.',
    ],
    know: [
      'Their bones are hardening enough to start showing on ultrasound images.',
      'Their scalp hair pattern is forming now — the part line they will keep.',
    ],
    tips: [
      'Many enjoy gentle movement again — walks, swimming, whatever feels good.',
      'Snacks within reach help now that the appetite is returning.',
      'Many people start a little bump photo ritual around now — once a week, same mirror.',
    ],
  },
  firstTimeNote:
    'You still won\'t feel them yet — most first-time parents feel the first flutters between 18 and 22 weeks, so there\'s nothing to wait anxiously for.',
  experiencedNote:
    'Second time around, you may feel them sooner — many experienced parents recognize the flutters earlier, sometimes this very week.',
  quietDay: { lookbackEligible: true },
};

const ROW_16: WeekMatrixRow = {
  week: 16,
  anchors: {
    baby: 'Their eyes are making slow side-to-side movements under closed lids. The wiring between brain and limbs is switching on.',
    body: 'They\'re busy in there, though most people can\'t feel it yet. Round-ligament twinges — brief low pulls — are common as things stretch.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: a layer of warmth — fat stores begin under their skin.',
  delight: {
    factIds: ['hiccups', 'startle-reflex', 'crying-practice'],
    freshAngles: ['The wiring switches on', 'Eyes practicing their moves', 'Hiccups before breaths'],
  },
  routineSeeds: {
    baby: [
      'Their eyes are making slow side-to-side movements under closed lids.',
      'Their nervous system and skeleton have wired up enough to coordinate limb movements.',
      'Their eyes are becoming sensitive to light, even though they stay shut.',
    ],
    body: [
      'They\'re moving plenty, though most people can\'t feel it yet — they\'re still small.',
      'Brief twinges low in the belly are common as the ligaments stretch.',
      'Skin may be changing — some people notice a new glow, others new spots or dryness.',
    ],
    know: [
      'Their ears are close to reaching their final position.',
      'Hiccups often start around now — silent practice for the breathing muscles.',
    ],
    tips: [
      'Many start sleeping with a pillow between the knees around now.',
      'Keeping a water bottle close helps with the stuffy-nose days.',
      'When standing for long stretches, shifting weight from foot to foot keeps many people comfortable.',
    ],
  },
  firstTimeNote:
    'The anatomy scan usually happens between 18 and 22 weeks — the long, detailed ultrasound many people look forward to.',
  experiencedNote:
    'You already know the scan drill — this time, bring the questions you wished you\'d asked last time.',
  quietDay: { lookbackEligible: true },
};

const ROW_17: WeekMatrixRow = {
  week: 17,
  anchors: {
    baby: 'A thin layer of fat is forming under {name}\'s skin — their built-in warmth. They\'re practicing sucking and swallowing for the world outside.',
    body: 'The appetite is often back, with opinions. The bump is becoming harder to hide.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: their ears settle into place, and the world starts to sound.',
  delight: {
    factIds: ['swallowing-practice', 'flavors-amniotic', 'heartbeat-fast'],
    freshAngles: ['A layer of warmth', 'Feeding rehearsal', 'Hearing comes online'],
  },
  routineSeeds: {
    baby: [
      'Fat stores are beginning to develop under their skin — warmth and energy for later.',
      'They\'re practicing sucking and swallowing — a feeding rehearsal.',
      'Their hearing is making big strides; their ears are nearly in their final form.',
    ],
    body: [
      'Lightheadedness sometimes appears around now, as the circulation keeps expanding.',
      'Appetite is often back with opinions — many find smaller, more frequent meals comfortable.',
      'The bump is becoming harder to hide — and harder not to smile about.',
    ],
    know: [
      'Their skeleton is still mostly soft cartilage — flexible by design.',
      'Their toenails are starting to develop this week.',
    ],
    tips: [
      'Many people find a snack between meals keeps energy steadier.',
      'Comfortable, low shoes help with the off-balance days.',
      'Many keep a glass of water by the bed now — night-time thirst is common.',
    ],
  },
  firstTimeNote:
    'Fat under their skin isn\'t chubbiness — it\'s insulation they\'ll need after birth. They\'re still tiny.',
  experiencedNote:
    'You know the appetite surge is coming — stock the foods that actually satisfied you last time, not the ones you imagined wanting.',
  quietDay: { lookbackEligible: true },
};

const ROW_18: WeekMatrixRow = {
  week: 18,
  anchors: {
    baby: 'Their ears have reached their final position — hearing is switching on. A door slamming might earn a little jump.',
    body: 'The first flutters often arrive sometime around now — or in the coming weeks. Many say it feels like popcorn or tiny bubbles.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: vernix — their own protective coat.',
  delight: {
    factIds: ['startle-reflex', 'heartbeat-fast', 'crying-practice'],
    freshAngles: ['Ears in final position', 'The startle reflex', 'Flutters incoming'],
  },
  routineSeeds: {
    baby: [
      'Their ears have reached their final position — hearing is switching on.',
      'Loud sounds may make them jump — the startle reflex is wired up.',
      'Their eyes face forward now, and their nervous system is building its protective myelin.',
    ],
    body: [
      'The first flutters often arrive sometime around now — or in the coming weeks.',
      'Many people notice their bump clearly now — softer clothes become the easy choice.',
      'Round-ligament twinges are common with quick movements.',
    ],
    know: [
      'They can likely hear your heartbeat and the rumble of your digestion.',
      'They\'re moving a lot in there — somersaults in a roomy womb.',
    ],
    tips: [
      'When you feel a flutter, pause and notice — many people remember their first.',
      'Talking or singing to them is a lovely habit to start — they can hear you.',
      'Many people rest a partner\'s hand on the bump at quiet times — flutters are easier to catch when you\'re still.',
    ],
  },
  firstTimeNote:
    'Hearing is switching on — talking, reading, or singing to your bump is a lovely habit to start now.',
  experiencedNote:
    'You know what flutters feel like now, so the waiting is different — less wondering, more recognizing.',
  quietDay: { lookbackEligible: true },
};

const ROW_19: WeekMatrixRow = {
  week: 19,
  anchors: {
    baby: '{Name} is getting their protective coat — vernix, a waxy layer over their skin. Meanwhile the brain\'s sensory areas are specializing.',
    body: 'The bump is usually unmistakable now. Skin keeps changing too — many notice new glow, new spots, or both.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: halfway — and the big anatomy scan.',
  delight: {
    factIds: ['vernix', 'flavors-amniotic', 'swallowing-practice'],
    freshAngles: ['The vernix coat', 'Senses specializing', 'Slowing down to refine'],
  },
  routineSeeds: {
    baby: [
      'A waxy coating called vernix is covering their skin — protection from the fluid.',
      'The brain\'s sensory areas for touch, taste, smell, sight, and sound are specializing.',
      'Their arms and legs are now in proportion — growth is slowing, refining instead.',
    ],
    body: [
      'The bump is usually unmistakable now — and may itch as it stretches.',
      'Skin changes continue for many — new spots, new glow, or darkening in places.',
      'Back aches are common as posture keeps adjusting.',
    ],
    know: [
      'Their kidneys are making urine — it becomes part of the amniotic fluid.',
      'Wake-and-sleep patterns are becoming more regular.',
    ],
    tips: [
      'Many find a gentle stretch routine eases the achy-back days.',
      'Keeping the belly moisturized comforts itchy, stretching skin for many people.',
      'Naps are still fair game — many people keep a short afternoon rest in the routine.',
    ],
  },
  firstTimeNote:
    'Vernix is just a protective coating, not something to worry about — most of it is gone before they\'re born.',
  experiencedNote:
    'You remember how the bump appeared overnight last time — enjoy the slower reveal, or brace for the same.',
  quietDay: { lookbackEligible: true },
};

const ROW_20: WeekMatrixRow = {
  week: 20,
  anchors: {
    baby: 'Halfway there — {name} is swallowing mouthfuls of amniotic fluid, practicing for their first real drink.',
    body: 'The anatomy scan usually happens in this window — a long, detailed look at how they\'re growing.',
  },
  milestones: [
    {
      id: 'halfway',
      label: 'Halfway there',
      weekOffset: 0,
      tone: 'celebrate',
      copy: 'Halfway through — 20 weeks of growing them, and 20 to go. Worth a small celebration.',
    },
    {
      id: 'anatomy-scan',
      label: 'Anatomy scan',
      weekOffset: 0,
      tone: 'inform',
      copy: 'The anatomy scan usually happens between 18 and 22 weeks — a detailed look at how they\'re growing.',
    },
  ],
  prep: [],
  nextWeekTeaser: 'Next week: their bone marrow starts making blood cells.',
  delight: {
    factIds: ['swallowing-practice', 'vernix', 'placenta'],
    rotatingBoost: ['milestone'],
    freshAngles: ['The halfway mark', 'Swallowing practice', 'The big scan'],
  },
  routineSeeds: {
    baby: [
      'They\'re swallowing amniotic fluid every day — digestive practice.',
      'Their heartbeat is strong enough to be heard with a stethoscope at a check-up.',
      'Their eyebrows are forming, and their hair is growing in.',
    ],
    body: [
      'The anatomy scan usually lands around now — a detailed look at their growth.',
      'Their movements are getting stronger — kicks and rolls instead of flutters.',
      'Many feel them more after meals or when lying quietly.',
    ],
    know: [
      'From 20 weeks, they\'re measured head to heel, not head to bottom.',
      'Most of the essential building is done — now it\'s growing and practicing.',
    ],
    tips: [
      'Many people bring a question list to the anatomy scan — it\'s a long appointment.',
      'A partner or friend at the scan makes the moment even better.',
      'Many people ask for a printed scan photo — the halfway portrait is a classic.',
    ],
  },
  firstTimeNote:
    'Halfway means the second half, not the home stretch — there\'s still plenty of growing to enjoy.',
  experiencedNote:
    'You\'ve been halfway before — notice what\'s the same and what\'s entirely new. No two halves are alike.',
  quietDay: { lookbackEligible: true },
};

const ROW_21: WeekMatrixRow = {
  week: 21,
  anchors: {
    baby: 'Their bone marrow has started making red blood cells — a new factory opening. Their taste buds are working too — dinner flavors reach them already.',
    body: 'Kicks and rolls are getting stronger and more regular. You may catch one from the outside soon.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: eyebrows, eyelids, lips — a face becoming distinct.',
  delight: {
    factIds: ['blood-type-bones', 'flavors-amniotic', 'cord-slack'],
    freshAngles: ['The blood factory opens', 'Tasting dinner already', 'Kicks you can see'],
  },
  routineSeeds: {
    baby: [
      'Their bone marrow has started making red blood cells — a new factory opening.',
      'Their taste buds are working — flavors from your meals reach them in the fluid.',
      'Their movements are more coordinated — kicks, rolls, and cord-grabbing.',
    ],
    body: [
      'Kicks may be visible from the outside now — a hand on the belly can catch one.',
      'Your center of gravity keeps shifting — comfortable shoes help.',
      'Skin may feel drier or more sensitive as it stretches.',
    ],
    know: [
      'Their liver and spleen have been making blood cells too — now the marrow joins in.',
      'Eyebrows and eyelids are formed — they can blink.',
    ],
    tips: [
      'Many people start noticing their active hours — often evenings, when you rest.',
      'Resting on your side with a pillow between the knees is a common comfort.',
      'Many people do a quiet kick-watch in the evening — lying still and just noticing.',
    ],
  },
  firstTimeNote:
    'If kicks feel stronger on some days and quiet on others, that\'s usual — they still have room to turn away.',
  experiencedNote:
    'You know their quiet days aren\'t a report card — you\'ve learned their rhythm is theirs, not a schedule.',
  quietDay: { lookbackEligible: true },
};

const ROW_22: WeekMatrixRow = {
  week: 22,
  anchors: {
    baby: 'Their lips, eyelids, and eyebrows are becoming distinct — a face you can almost picture. Their senses are all coming online.',
    body: 'Sleep often needs more engineering now — pillows everywhere is normal. Their movements are a daily show.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: fingerprints, one of a kind.',
  delight: {
    factIds: ['lanugo', 'vernix', 'skull-soft'],
    freshAngles: ['A face becoming distinct', 'Senses waking up', 'The wrinkled phase'],
  },
  routineSeeds: {
    baby: [
      'Their lips, eyelids, and eyebrows are becoming distinct — their face is nearly complete.',
      'They\'re fully coated in lanugo, which holds the vernix to their skin.',
      'Their senses are waking up — they can feel touch, hear sounds, and sense light.',
    ],
    body: [
      'Sleep often needs more engineering now — pillows everywhere is normal.',
      'Back and hip aches are common as everything keeps adjusting.',
      'Their movements are strong and regular — a daily show.',
    ],
    know: [
      'Their lungs are still maturing — among the last systems to finish.',
      'Some people notice gentle, irregular tightenings — practice contractions — around now.',
    ],
    tips: [
      'Many find a short daily walk loosens the achy-back days.',
      'Keeping water nearby helps — thirst often rises with blood volume.',
      'Many people start a simple wind-down routine — same time, dim lights, comfy pillows.',
    ],
  },
  firstTimeNote:
    'Their face is nearly complete now — the ultrasound photos start looking like a person you know.',
  experiencedNote:
    'You know what\'s coming in the third trimester — these are the weeks to enjoy the sweet spot.',
  quietDay: { lookbackEligible: true },
};

const ROW_23: WeekMatrixRow = {
  week: 23,
  anchors: {
    baby: 'Ridges are forming on {name}\'s fingertips — their fingerprints, one of a kind. Their lungs are practicing the movements of breathing.',
    body: 'They move on their own schedule — often livelier when you lie down at night. Those rhythmic jerks are usually hiccups.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: the growing continues — and their world of sound gets richer.',
  delight: {
    factIds: ['fingerprints', 'rem-sleep', 'hiccups'],
    freshAngles: ['Fingerprints, one of a kind', 'Breathing rehearsal', 'Dream-sleep begins'],
  },
  routineSeeds: {
    baby: [
      'Ridges are forming on their fingers and toes — fingerprints, one of a kind.',
      'Their lungs are practicing the movements of breathing.',
      'Rapid eye movements have begun — the sleep stage where adults dream.',
    ],
    body: [
      'They move on their own schedule — often livelier when you lie down at night.',
      'Hiccups may appear as tiny rhythmic jerks — breathing-muscle practice.',
      'Swelling in feet and ankles is common now.',
    ],
    know: [
      'Their weight will nearly double in the next month.',
      'Their lanugo may darken around now — sometimes visible on ultrasound.',
    ],
    tips: [
      'Many people rest with feet up in the evenings — ankles appreciate it.',
      'Noticing their active times is a sweet evening ritual.',
      'Many people keep a small notebook of their patterns — fun to look back on later.',
    ],
  },
  firstTimeNote:
    'Those rhythmic jerks are usually hiccups — a tiny person practicing breathing, nothing to worry about.',
  experiencedNote:
    'You know the dance-party-at-bedtime pattern — last time it became the family joke. Here it is again.',
  quietDay: { lookbackEligible: true },
};

const ROW_24: WeekMatrixRow = {
  week: 24,
  anchors: {
    baby: "{Name}'s lungs are practicing for the outside world — tiny air sacs are forming, and surfactant is on its way.",
    body: 'The glucose screening window commonly opens now — most clinics offer it between 24 and 28 weeks.',
  },
  milestones: [
    {
      id: 'viability',
      label: 'Viability milestone',
      weekOffset: 0,
      tone: 'inform',
      copy: 'Week 24 is often called the viability milestone — the earliest point at which a baby born this early could keep going with intensive care. A quiet fact to tuck away.',
    },
  ],
  prep: [],
  nextWeekTeaser: 'Next week: {name} may start responding to familiar voices.',
  delight: {
    factIds: ['lanugo', 'startle-reflex', 'rem-sleep'],
    rotatingBoost: ['partner'],
    freshAngles: ['The last week of lanugo season', 'Practicing breaths, amniotic-style', 'What REM sleep looks like before birth'],
  },
  routineSeeds: {
    baby: [
      "The lungs are making their first surfactant, the coating that will one day help the air sacs stay open.",
      "Movements are getting stronger as the muscles keep building.",
      "The inner ear is in place, so {name} is starting to sense position and sound.",
    ],
    body: [
      'The glucose screening is commonly offered between 24 and 28 weeks — many clinics schedule it at a regular visit.',
      'Leg cramps and backaches show up for many people around now as the body carries more weight.',
      'Sleep can get choppy; rest comes in whatever pieces it comes in.',
    ],
    know: [
      'The viability milestone is about biology catching up — it is simply a line many providers note on the calendar.',
      'The lungs will keep maturing for weeks yet; every week still matters.',
    ],
    tips: [
      'Keep a small list of questions for visits — the 24–28 week stretch brings a few new topics.',
      'A short walk or gentle stretch is a common comfort for restless legs.',
      'The glucose screening usually means a sweet drink and a short wait — many people bring a book and schedule it for the morning.',
    ],
  },
  firstTimeNote:
    'The glucose screening is a routine blood-sugar check most clinics do between 24 and 28 weeks — nothing to prepare for, just a sweet drink and a blood draw.',
  experiencedNote:
    'You already know the glucose-screening drill — but notice how the questions have changed since last time. Experience makes the routine faster, not the curiosity smaller.',
  quietDay: { lookbackEligible: true },
};

const ROW_25: WeekMatrixRow = {
  week: 25,
  anchors: {
    baby: '{Name} may now move in response to familiar sounds — like a voice {name} has been hearing all along.',
    body: 'The glucose screening window is open — many people have it done at a routine visit this week or next.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: eyelashes and eyebrows are taking shape.',
  delight: {
    factIds: ['rem-sleep', 'startle-reflex', 'hiccups'],
    freshAngles: ['Which voices does a baby know first?', 'Dreaming before the first breath', 'The jumpy days of the startle reflex'],
  },
  routineSeeds: {
    baby: [
      'Familiar voices — especially yours — may now draw a kick or a shift.',
      'Most sleep time is spent in rapid eye movement, the active dreaming kind of sleep.',
      'Hair keeps growing, and the hands are practicing their grasp.',
    ],
    body: [
      'Heartburn and indigestion are common companions now as everything shifts upward.',
      'Many people notice their hair growing faster — one of the nicer side effects.',
      'Backaches and a growing belly can make favorite sleeping positions a memory.',
    ],
    know: [
      'Movement patterns still vary day to day at 25 weeks — there is no daily quota yet.',
      'Sudden loud sounds may startle {name} now; it is simply the nervous system waking up.',
    ],
    tips: [
      'Talking, singing, or reading aloud is a lovely way to be together across the belly.',
      'A body pillow between the knees is a common comfort for side sleeping.',
      'If heartburn visits at night, many people find an extra pillow or an earlier dinner helps them settle.',
    ],
  },
  firstTimeNote:
    'Movement still comes and goes at 25 weeks — quiet days and busy days are both ordinary. Patterns settle later.',
  experiencedNote:
    'This time you can tell the difference between a kick and a hiccup without checking — that fluency is the quiet reward of round two.',
  quietDay: { lookbackEligible: true },
};

const ROW_26: WeekMatrixRow = {
  week: 26,
  anchors: {
    baby: "{Name}'s eyes are fully formed and nearly ready to open — and the lungs have begun making surfactant.",
    body: 'If the glucose screening has not happened yet, many clinics fit it in this week — the window closes at 28.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: the second trimester comes to a close.',
  delight: {
    factIds: ['eyes-open-close', 'rem-sleep', 'fingerprints'],
    freshAngles: ['Almost time to open those eyes', 'Surfactant: the lung-soap story', 'Fingerprints are nearly finished'],
  },
  routineSeeds: {
    baby: [
      'Eyebrows and eyelashes have formed; the eyes themselves are developed and will open soon.',
      'The lungs have begun producing surfactant, which will eventually help the air sacs inflate.',
      'Rhythmic breathing movements are practicing, even though there is no air yet — only fluid.',
    ],
    body: [
      'Swelling in the feet and ankles is common by now, especially by evening.',
      'Back pain and heartburn tend to tag-team in the late second trimester.',
      'Braxton Hicks may pop up — a tightening that comes and goes on its own.',
    ],
    know: [
      'The glucose screening window is 24–28 weeks, so this is often the week it happens.',
      'Breathing practice in the womb moves fluid, not air — it is rehearsal, not breathing.',
    ],
    tips: [
      'Elevating the feet for a while in the evening is a common comfort for swollen ankles.',
      'Keep the glucose-screening appointment time noted — some clinics schedule it for a morning visit.',
      'Mornings can arrive with an appetite — some people keep a small snack by the bed.',
    ],
  },
  firstTimeNote:
    'Braxton Hicks are practice tightenings — the uterus flexing, then relaxing. Many people feel them first around now, and they come and go without a pattern.',
  experiencedNote:
    'You know the difference between a Braxton Hicks and the real thing in your bones — this time you can spend the tightening on curiosity instead of the stopwatch.',
  quietDay: { lookbackEligible: true },
};

const ROW_27: WeekMatrixRow = {
  week: 27,
  anchors: {
    baby: "{Name}'s nervous system is maturing quickly, and a soft layer of fat is smoothing out the skin.",
    body: 'The second trimester is ending — many people feel a gear-shift as the third trimester approaches.',
  },
  milestones: [
    {
      id: 'second-trimester-ends',
      label: 'Second trimester ends',
      weekOffset: 0,
      tone: 'inform',
      copy: 'This week marks the end of the second trimester. Two down, one to go.',
    },
    {
      id: 'third-trimester-begins',
      label: 'Third trimester begins',
      weekOffset: 1,
      tone: 'celebrate',
      copy: 'Next week the third trimester begins — the home stretch, and mostly growing from here.',
    },
  ],
  prep: [],
  nextWeekTeaser: 'Next week: hello, third trimester.',
  delight: {
    factIds: ['brain-folds', 'rem-sleep', 'hiccups'],
    rotatingBoost: ['milestone'],
    freshAngles: ['The brain is folding itself into shape', 'Fat: the great smoother', 'Two trimesters down'],
  },
  routineSeeds: {
    baby: [
      'The nervous system is maturing — signals travel faster and movements look more coordinated.',
      'Fat is accumulating under the skin, which will help with temperature control later.',
      'Sleep and wake periods are getting more distinct, even if they do not match yours.',
    ],
    body: [
      'Fatigue often creeps back in the final weeks of the second trimester.',
      'Leg cramps, especially at night, are a common visitor around now.',
      'The belly is high and noticeable; bending over is becoming a project.',
    ],
    know: [
      'The glucose screening window closes at 28 weeks — most clinics have it done by now.',
      'The Tdap vaccine is commonly offered between 27 and 36 weeks; many clinics mention it around now.',
    ],
    tips: [
      'A warm bath or gentle stretching before bed is a common comfort for night cramps.',
      'Start a loose list of third-trimester questions — visits get more frequent soon.',
      'Notice what restores you this week — the third trimester is kinder to people who already know.',
    ],
  },
  firstTimeNote:
    'The trimesters are just a way of dividing 40 weeks — the baby does not notice the boundary, but it is a nice moment to take stock of how far you have come.',
  experiencedNote:
    'You remember how fast the third trimester went last time — or how slow. Either way, the end-of-second-trimester pause is a good moment to note what you want different this round.',
  quietDay: { lookbackEligible: true },
};

const ROW_28: WeekMatrixRow = {
  week: 28,
  anchors: {
    baby: "{Name}'s eyelids can partially open now — and the brain can direct breathing movements and body temperature.",
    body: 'Welcome to the third trimester — visits often move to every two weeks from here.',
  },
  milestones: [
    {
      id: 'third-trimester',
      label: 'Third trimester begins',
      weekOffset: 0,
      tone: 'celebrate',
      copy: 'The third trimester begins this week. Mostly growing, plumping, and practicing from here.',
    },
  ],
  prep: [],
  nextWeekTeaser: 'Next week: kicks, stretches, and grasping — the womb gets lively.',
  delight: {
    factIds: ['eyes-open-close', 'voice-recognition', 'sleep-cycles'],
    rotatingBoost: ['milestone'],
    freshAngles: ['First peeks through half-open lids', 'The brain takes the thermostat', 'Every-two-week visits begin'],
  },
  routineSeeds: {
    baby: [
      'The eyelids can partially open, and eyelashes have formed.',
      'The central nervous system can now direct rhythmic breathing movements.',
      'Body temperature control is coming online — one more system checking in.',
    ],
    body: [
      'Prenatal visits often shift to every two weeks from 28 weeks until 36.',
      'Third-trimester fatigue is real for many people — the body is doing heavy lifting.',
      'Trouble sleeping, backaches, and shortness of breath on stairs are common company now.',
    ],
    know: [
      'Many clinics mention the Tdap vaccine between 27 and 36 weeks — it is a routine third-trimester topic.',
      'Kick awareness becomes a thing providers talk about in the third trimester — {name} has a usual pattern, and you will learn it.',
    ],
    tips: [
      'Pillows become architecture now — between the knees, under the belly, behind the back.',
      'Keep a running note of questions; with visits every two weeks, the list turns over faster.',
      'When sleep will not come, many people stop fighting it — a quiet audiobook on the couch counts as rest.',
    ],
  },
  firstTimeNote:
    'Every-two-week visits are usually short — heartbeat, measuring, and your questions. The rhythm of the third trimester has begun.',
  experiencedNote:
    'You know this cadence — the fortnightly check-in, the tape measure, the quick listen. This time the novelty is noticing how differently your body is doing it.',
  quietDay: { lookbackEligible: true },
};

const ROW_29: WeekMatrixRow = {
  week: 29,
  anchors: {
    baby: '{Name} can kick, stretch, and make grasping movements — the womb is getting lively.',
    body: 'The every-two-week visit rhythm settles in — short appointments, steady reassurance.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: eyes open wide, and the bone marrow gets to work.',
  delight: {
    factIds: ['crying-practice', 'hiccups', 'brain-folds'],
    freshAngles: ['The grasp reflex in action', 'Kicks you can see from the outside', 'Practice cries, silent edition'],
  },
  routineSeeds: {
    baby: [
      'Kicks, stretches, and grasping movements are all on the menu now.',
      'The lungs keep maturing, and rhythmic breathing practice continues.',
      'The brain is growing quickly, adding connections week by week.',
    ],
    body: [
      'Many people feel {name} move more when they are resting — quiet moments, loud belly.',
      'Backaches and leg cramps often tag-team in the late evening.',
      'Heartburn may be a regular dinner guest as the uterus presses upward.',
    ],
    know: [
      'Movement has a personality now — busy stretches and quiet stretches, and you are learning the difference.',
      'Hiccups feel like tiny rhythmic jerks in one spot — a common and ordinary sensation.',
    ],
    tips: [
      'Smaller, more frequent meals are a common comfort for third-trimester heartburn.',
      'If the partner has not felt a kick yet, a quiet evening together is often when it happens.',
      'A warm bath in the evening is a common wind-down for the achy-back hours.',
    ],
  },
  firstTimeNote:
    'Hiccups in the womb feel like a tiny, steady pulse in one spot — many people mistake them for kicks at first. Both are ordinary.',
  experiencedNote:
    'You already have a mental catalog of movement types from last time — this round the fun is spotting how this baby\'s rhythm differs from the last.',
  quietDay: { lookbackEligible: true },
};

const ROW_30: WeekMatrixRow = {
  week: 30,
  anchors: {
    baby: "{Name}'s eyes can open wide now — and the bone marrow has taken over making red blood cells.",
    body: 'The belly is firmly in the way of everything — bending, sleeping, and shoelaces are all projects now.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: rapid weight gain begins — the plumping phase.',
  delight: {
    factIds: ['brain-folds', 'fingerprints', 'swallowing-practice'],
    freshAngles: ['The week the bone marrow clocks in', 'A good head of hair', 'Eyes wide open in the dark'],
  },
  routineSeeds: {
    baby: [
      'The eyes can open wide — blinking and all.',
      'A good head of hair may be growing by now.',
      'Red blood cells are forming in the bone marrow, which has taken over the job.',
    ],
    body: [
      'Shortness of breath on stairs or hills is common — everything is compressed upward.',
      'Sleep is often broken into chapters; naps count as chapters too.',
      'Swollen feet by evening are ordinary for many people.',
    ],
    know: [
      'The bone marrow taking over blood-cell production is a quiet changing of the guard.',
      'Thirty weeks still leaves ten of growing — the finishing work is mostly ahead.',
    ],
    tips: [
      'Shoes that slip on without bending are a small kindness to yourself now.',
      'A cool, dark bedroom helps with the broken-sleep chapters.',
      'Naps are not laziness now — they are how the body catches up on the night\'s broken chapters.',
    ],
  },
  firstTimeNote:
    'Around 30 weeks many people start feeling very pregnant — the belly leads, everything else follows. That is the third trimester doing its thing.',
  experiencedNote:
    'You know the ten-weeks-to-go math by heart — and you know the last stretch has its own weather. Pace yourself like someone who has done this before, because you have.',
  quietDay: { lookbackEligible: true },
};

const ROW_31: WeekMatrixRow = {
  week: 31,
  anchors: {
    baby: "{Name} has finished most major development — now comes the rapid weight-gain phase.",
    body: 'Sleep and wake patterns may be getting regular for {name} — which makes one of you.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: 'Next week: toenails are in, and the lungs keep practicing.',
  delight: {
    factIds: ['sleep-cycles', 'flavors-amniotic', 'hiccups'],
    freshAngles: ['All five senses, on duty', 'The plumping-up begins', 'Tasting the menu through amniotic fluid'],
  },
  routineSeeds: {
    baby: [
      'Most major development is done — from here it is mostly gaining weight, quickly.',
      'All five senses are working now: seeing, hearing, tasting, touching, and soon smelling.',
      'Sleeping and waking patterns are becoming more regular.',
    ],
    body: [
      'The uterus is well above the belly button now, and breathing room is limited.',
      'Many people feel more tired again — the third-trimester fatigue wave.',
      'Back pain and a waddling gait are common companions of the growing belly.',
    ],
    know: [
      '{name} can taste what you eat through the amniotic fluid — flavors pass through in small doses.',
      'Regular sleep-wake cycles mean quiet stretches are simply naptime, not silence.',
    ],
    tips: [
      'Rest is productive now — the body is building a person at full speed.',
      'A warm shower before bed is a common wind-down for achy backs.',
      'Saying yes to help is a skill worth practicing — meals, errands, company.',
    ],
  },
  firstTimeNote:
    'The "all five senses are working" line surprises many first-timers — {name} can hear, taste, touch, and see light and dark. Only smell waits for the first breath of air.',
  experiencedNote:
    'Last time, the senses-working fact may have been trivia — this time it lands differently, because you have watched a newborn react to your voice and known exactly when that started.',
  quietDay: { lookbackEligible: true },
};

const ROW_32: WeekMatrixRow = {
  week: 32,
  anchors: {
    baby: "{Name}'s toenails are visible now — and the soft downy lanugo is starting to fall away.",
    body: 'Birth-plan thoughts often surface around now — many people start jotting down preferences, wishes not rules.',
  },
  milestones: [],
  prep: [PREP_BIRTH_PLAN],
  nextWeekTeaser: 'Next week: bones are hardening — all except the skull, which stays soft on purpose.',
  delight: {
    factIds: ['light-turn', 'skull-soft', 'crying-practice'],
    rotatingBoost: ['story'],
    freshAngles: ['Goodbye, lanugo', 'Practicing breaths with fluid', 'Toenails: the tiny details'],
  },
  routineSeeds: {
    baby: [
      'The toenails are visible — one more tiny detail finished.',
      'Lanugo, the soft downy hair of the past months, is starting to shed.',
      'The lungs are maturing, and rhythmic breathing practice continues.',
    ],
    body: [
      'Many people start thinking about birth preferences around now — a few wishes jotted down, not a contract.',
      'Braxton Hicks may be more noticeable; they come and go without settling into a pattern.',
      'Leaky breasts (a little colostrum) are common and ordinary.',
    ],
    know: [
      '{name} can sense changes in light now — bright light may draw a turn or a stillness.',
      'The brain and nervous system are still developing quickly; the finishing work continues.',
    ],
    tips: [
      'If a birth plan is on your mind, a few bullet points in a notes app is plenty to start.',
      'Nursing pads exist for a reason — many people start keeping a few around now.',
      'Thirst arrives unannounced in the third trimester — many people keep water within arm\'s reach everywhere.',
    ],
  },
  firstTimeNote:
    'A birth plan is simply a list of preferences — who you want nearby, what comforts matter to you. Wishes, not rules; the day itself gets a vote too.',
  experiencedNote:
    'You wrote one of these before — or deliberately did not. Either way, this time the plan can be shorter: you know which three things actually mattered last time.',
  quietDay: { lookbackEligible: true },
};

const ROW_33: WeekMatrixRow = {
  week: 33,
  anchors: {
    baby: "{Name}'s bones are hardening — every one except the skull, which stays soft and flexible on purpose.",
    body: 'Space is getting tight in there — kicks may feel less like punches and more like rolls.',
  },
  milestones: [],
  prep: [PREP_BIRTH_PLAN],
  nextWeekTeaser: 'Next week: the protective vernix coating gets thicker.',
  delight: {
    factIds: ['skull-soft', 'brain-folds', 'light-turn'],
    freshAngles: ['Why the skull stays soft', 'Rolls instead of kicks', 'Pupils learning the light'],
  },
  routineSeeds: {
    baby: [
      'The bones are hardening throughout the body — except the skull bones, which stay soft and separated.',
      'The pupils can react to light now, dilating and constricting.',
      'The lungs keep working toward maturity, week by week.',
    ],
    body: [
      'Movements may feel different — less room means rolls and stretches instead of sharp kicks.',
      'Trouble finding a comfortable sleeping position is nearly universal now.',
      'Shortness of breath and heartburn often peak around these weeks.',
    ],
    know: [
      'The soft skull is by design — the bones slide and flex for the journey through the birth canal.',
      'Quieter-feeling movement is often just less room, not less baby — the pattern matters more than the punch.',
    ],
    tips: [
      'Side-lying with pillows is the classic answer to the sleep puzzle.',
      'Keep the birth-plan notes somewhere the partner can find them too.',
      'A short daily walk can ease the stiffness — no distance goals, just gentle movement.',
    ],
  },
  firstTimeNote:
    'The skull staying soft sounds alarming and is completely the opposite — it is one of the cleverest pieces of design in the whole process.',
  experiencedNote:
    'You have seen the soft spot on a newborn head up close — the fontanelle. That is this week\'s work, finishing. You know it closes on its own schedule.',
  quietDay: { lookbackEligible: true },
};

const ROW_34: WeekMatrixRow = {
  week: 34,
  anchors: {
    baby: "{Name}'s vernix — the creamy coating protecting the skin — is getting thicker.",
    body: 'Hospital-bag packing often starts around now — many people like having it ready, just in case.',
  },
  milestones: [],
  prep: [PREP_HOSPITAL_BAG, PREP_BIRTH_PLAN, PREP_PEDIATRICIAN],
  nextWeekTeaser: 'Next week: kidneys and liver are up and running.',
  delight: {
    factIds: ['surfactant', 'vernix', 'swallowing-practice'],
    rotatingBoost: ['story'],
    freshAngles: ['Vernix: nature\'s cold cream', 'The lungs\' almost-ready report', 'Fingernails reach the fingertips'],
  },
  routineSeeds: {
    baby: [
      'The vernix coating the skin is thickening — it protects the skin in all that fluid.',
      'The lungs are maturing steadily; surfactant production is well underway.',
      'Weight gain is significant now — roughly a steady climb each week.',
    ],
    body: [
      'Many people pack a hospital bag around now — a gentle checklist, not a deadline.',
      'Choosing a pediatrician is a common task for these weeks — one less thing later.',
      'Fatigue, swelling, and frequent bathroom trips are the usual trio.',
    ],
    know: [
      'The vernix mostly disappears before birth — some babies arrive with a little still on.',
      'The lungs are among the last organs to fully mature; they keep working until the end.',
    ],
    tips: [
      'Pack the bag in layers — the essentials first, the nice-to-haves after.',
      'Keep the pediatrician\'s number saved where both of you can find it.',
      'Charge the phone and camera overnight — ordinary days are worth capturing too.',
    ],
  },
  firstTimeNote:
    'The hospital bag is just a packed bag by the door — documents, comfy clothes, snacks, and the car-seat plan. Packing it early is about peace of mind, not a countdown.',
  experiencedNote:
    'Last time you probably overpacked — everyone does. This time you know the truth: the hospital has nearly everything, and you need far less than you think.',
  quietDay: { lookbackEligible: true },
};

const ROW_35: WeekMatrixRow = {
  week: 35,
  anchors: {
    baby: "{Name}'s kidneys and liver are up and running — processing waste like a tiny pro.",
    body: 'The home stretch is close — weekly visits begin next week, and the bag by the door is good company.',
  },
  milestones: [
    {
      id: 'early-term-ahead',
      label: 'Early term ahead',
      weekOffset: 1,
      tone: 'inform',
      copy: 'Next week brings weekly visits — and from 37 weeks, early term. Nearly there.',
    },
  ],
  prep: [PREP_HOSPITAL_BAG, PREP_BIRTH_PLAN, PREP_PEDIATRICIAN],
  nextWeekTeaser: 'Next week: weekly visits begin — the final countdown rhythm.',
  delight: {
    factIds: ['surfactant', 'blood-type-bones', 'voice-recognition'],
    rotatingBoost: ['milestone'],
    freshAngles: ['The kidneys clock in', 'Plumping up the limbs', 'Five weeks of finishing touches'],
  },
  routineSeeds: {
    baby: [
      'The kidneys are fully developed and the liver can process waste products.',
      'The brain keeps growing quickly — it still has developing to do.',
      'Fat is padding out the arms and legs, smoothing everything into newborn shape.',
    ],
    body: [
      'Weekly prenatal visits usually start at 36 weeks — one more week of the fortnightly rhythm.',
      'Sleep is a puzzle with missing pieces for many people now.',
      'Swelling, backaches, and the need to pee constantly are the standard-issue trio.',
    ],
    know: [
      'The kidneys and liver coming online is one of the last systems to check in.',
      'Most of the remaining weeks are about growing bigger and stronger — the systems are nearly all in place.',
    ],
    tips: [
      'Keep the hospital bag by the door — knowing it is packed feels good.',
      'Freeze a few easy meals if the energy strikes; future-you says thanks.',
      'Rest when the body asks — building a person at full speed is the work.',
    ],
  },
  firstTimeNote:
    'Weekly visits start next week — quick check-ins, mostly listening and measuring. The final rhythm of pregnancy.',
  experiencedNote:
    'You remember the weekly-visit stretch — the strange mix of routine and anticipation. This time you know the ending is not an emergency, just an arrival.',
  quietDay: { lookbackEligible: true },
};
/* ------------------------------------------------------------------ */
/* Curated rows: weeks 36–42.                                          */
/* ------------------------------------------------------------------ */

const ROW_36: WeekMatrixRow = {
  week: 36,
  anchors: {
    baby: '{Name} is gaining about an ounce a day now. The plumping-up phase.',
    body: 'Weekly check-ins often begin now — short visits, mostly listening.',
  },
  milestones: [
    {
      id: 'weekly-visits',
      label: 'Weekly visits',
      weekOffset: 0,
      tone: 'inform',
      copy: 'Weekly check-ins start around week 36 — quick visits, heartbeat and measuring.',
    },
    {
      id: 'early-term',
      label: 'Early term',
      weekOffset: 1,
      tone: 'inform',
      copy: 'One week to early term — from 37 weeks, it\'s mostly plumping up from here.',
    },
  ],
  prep: [PREP_HOSPITAL_BAG, PREP_BIRTH_PLAN, PREP_PEDIATRICIAN, PREP_CAR_SEAT],
  nextWeekTeaser: 'Next week: early term begins — the home stretch, officially.',
  delight: {
    factIds: ['head-down', 'surfactant', 'voice-recognition'],
    rotatingBoost: ['story'],
    freshAngles: ['The final plumping-up weeks', 'Nesting instinct peaks'],
  },
  routineSeeds: {
    baby: [
      'Gaining about an ounce a day. The plumping-up phase.',
      'The brain and lungs are putting on finishing touches.',
      'They\'re likely head-down now, settling into place for their arrival.',
    ],
    body: [
      'Weekly check-ins often start now. They\'re usually short and reassuring.',
      'Sleep is choppy. Rest when you can, without guilt.',
      'Braxton Hicks may be more noticeable now. It\'s a tightening feeling that comes and goes.',
    ],
    know: [
      'Group B strep screening usually happens around 36–37 weeks — a quick swab, nothing more.',
      'Kick counts: many providers suggest keeping an eye on their usual pattern.',
    ],
    tips: [
      'Keep the hospital bag by the door. Knowing it\'s packed feels good.',
      'Stock the freezer with a few easy meals. You\'ll be glad later.',
    ],
  },
  firstTimeNote:
    'Weekly visits are quick — mostly heartbeat, measuring, and your questions. Bring the list.',
  experiencedNote:
    'You know the weekly-visit rhythm — in and out. This time, notice what\'s different: every pregnancy has its own texture.',
  quietDay: { lookbackEligible: true },
};

const ROW_37: WeekMatrixRow = {
  week: 37,
  anchors: {
    baby: 'Early term means {name}\'s organs are ready. Now it\'s all about plumping up.',
    body: 'The heaviness shifts — many describe week 37 as "any day now" energy.',
  },
  milestones: [
    {
      id: 'early-term',
      label: 'Early term',
      weekOffset: 0,
      tone: 'celebrate',
      copy: 'Early term — finishing touches done. Arrival could be weeks or days away.',
    },
  ],
  prep: LATE_PREP,
  nextWeekTeaser: 'Next week: full term is one week closer — the finish line is in sight.',
  delight: {
    factIds: ['voice-recognition', 'sleep-cycles', 'light-turn'],
    rotatingBoost: ['name'],
    freshAngles: ['Names are on everyone\'s mind now', 'The "any day now" feeling'],
  },
  routineSeeds: {
    baby: [
      'At early term, the brain and lungs are ready for the outside world.',
      'They\'re gaining steadily, about half a pound a week.',
      'Vernix is mostly gone, and their skin is smoothing out.',
    ],
    body: [
      'The "any day now" feeling is real, and it\'s completely normal.',
      'Rest is productive now. Growing a person is the work.',
      'You might notice more discharge as your body quietly prepares.',
    ],
    know: [
      'Early term spans 37–38 weeks; full term starts at 39.',
      'If your water breaks or contractions find a rhythm, most providers want to hear from you.',
    ],
    tips: [
      'Keep your phone charged and the car fueled. The boring stuff matters.',
      'A short daily walk can feel good. No distance goals, just gentle.',
    ],
  },
  firstTimeNote:
    'Early term doesn\'t mean "today" — most first babies arrive closer to 40–41 weeks. No need to watch the clock.',
  experiencedNote:
    'You know early term is a window, not a starting gun. Second babies sometimes come faster once things begin — keep the bag close.',
  quietDay: { lookbackEligible: true },
};

const ROW_38: WeekMatrixRow = {
  week: 38,
  anchors: {
    baby: '{Name}\'s grip is strong now. They\'ll wrap those tiny fingers around yours.',
    body: 'The finish line is close enough to picture — rest is the assignment.',
  },
  milestones: [
    {
      id: 'full-term',
      label: 'Full term',
      weekOffset: 1,
      tone: 'prepare',
      copy: 'One week to full term — nearly all the finishing touches are in.',
    },
  ],
  prep: LATE_PREP,
  nextWeekTeaser: 'Next week: full term — the milestone everyone\'s been waiting for.',
  delight: {
    factIds: ['rem-sleep', 'brain-folds', 'startle-reflex'],
    rotatingBoost: ['story'],
    freshAngles: ['The final refinements', 'Almost-done organs'],
  },
  routineSeeds: {
    baby: [
      'Their organs are ready, and they\'re mostly gaining weight now.',
      'Their grip reflex is strong now, ready to wrap around your finger.',
      'Their brain is still developing quickly.',
    ],
    body: [
      'Trouble sleeping is pretty common now. Naps count.',
      'You might feel them drop lower. That\'s the "lightening" everyone talks about.',
      'Swelling in feet and ankles is common. Rest with your feet up.',
    ],
    know: [
      'Full term at 39 weeks is when most systems are at their best.',
      'Contractions that come regularly and get stronger deserve a call.',
    ],
    tips: [
      'Say yes to help. Meals, errands, company.',
      'Pack snacks for the hospital bag. Labor is hungry work.',
    ],
  },
  firstTimeNote:
    '"Lightening" — when they drop lower — can make breathing easier and walking stranger, both at once.',
  experiencedNote:
    'You remember the restless nights. This time, try the things that worked last time sooner — you already know your tricks.',
  quietDay: { lookbackEligible: true },
};

const ROW_39: WeekMatrixRow = {
  week: 39,
  anchors: {
    baby: 'Full term. {name} is ready whenever they are. The grand finale.',
    body: 'You\'ve done the long work — now it\'s waiting, wonderfully.',
  },
  milestones: [
    {
      id: 'full-term',
      label: 'Full term',
      weekOffset: 0,
      tone: 'celebrate',
      copy: 'Full term — 39 weeks. The milestone every week was building toward.',
    },
  ],
  prep: LATE_PREP,
  nextWeekTeaser: 'Next week: the due date — a milestone, not a deadline.',
  delight: {
    factIds: ['crying-practice', 'fingerprints', 'heartbeat-fast'],
    rotatingBoost: ['tradition'],
    freshAngles: ['Celebrating the long build', 'Ready whenever they are'],
  },
  routineSeeds: {
    baby: [
      'At full term, every system is ready for the outside world.',
      'They\'re about 20 inches long and a little over 7 pounds.',
      'The placenta is still working hard, right to the end.',
    ],
    body: [
      'Nesting may peak now. It\'s easy to go overboard, so take it easy.',
      'False alarms are common. Timing contractions helps you tell the difference.',
      'You\'re in the home stretch. Be extra kind to yourself.',
    ],
    know: [
      'Only about 1 in 20 babies arrives on the due date — the rest are fashionably early or late.',
      'Membrane sweeps and induction are conversations to have with your provider, not the internet.',
    ],
    tips: [
      'Keep everything wonderfully boring. Routine is restful.',
      'Keep the phone and camera charged.',
    ],
  },
  firstTimeNote:
    'The due date is an estimate with a two-week margin on either side — most first babies come after it, not on it.',
  experiencedNote:
    'You know due dates are suggestions. Trust your body\'s timeline — it has done this before.',
  quietDay: { lookbackEligible: true },
};

const ROW_40: WeekMatrixRow = {
  week: 40,
  anchors: {
    baby: 'The due date is {name}\'s estimated arrival. They\'ll come on their own schedule.',
    body: 'You\'ve carried them 40 weeks — an extraordinary, ordinary miracle.',
  },
  milestones: [
    {
      id: 'due-date',
      label: 'Due date',
      weekOffset: 0,
      tone: 'celebrate',
      copy: 'The due date — 40 weeks. A milestone to mark, not a deadline.',
    },
  ],
  prep: LATE_PREP,
  nextWeekTeaser: 'Next week: if they\'re still cozy, extra check-ins keep everyone reassured.',
  delight: {
    factIds: ['vernix', 'skull-soft', 'blood-type-bones'],
    rotatingBoost: ['partner'],
    freshAngles: ['The estimated day', 'Celebrating 40 weeks of work'],
  },
  routineSeeds: {
    baby: [
      'They\'re fully ready, just waiting for the right moment.',
      'Around 20 inches long and 7½ pounds. A classic newborn size.',
      'Their skull is still soft and flexible. That helps with the birth itself.',
    ],
    body: [
      'Waiting is the work now, and it\'s real work.',
      'Gentle movement can feel good. So can doing nothing.',
      'Your provider will want to see you regularly from here.',
    ],
    know: [
      'Post-term starts at 42 weeks; between 40 and 42, extra monitoring is common.',
      'Keep your provider\'s number handy — they\'ll tell you exactly what deserves a call.',
    ],
    tips: [
      'Distraction is a strategy. Films, walks, naps.',
      'Let people help. This is what the village is for.',
    ],
  },
  firstTimeNote:
    'If they\'re not here yet, that\'s normal — nearly half of first babies arrive after 40 weeks.',
  experiencedNote:
    'You know the waiting game. Same playbook: rest, distraction, and trust.',
  quietDay: { lookbackEligible: true },
};

const ROW_41: WeekMatrixRow = {
  week: 41,
  anchors: {
    baby: 'Still cozy. Some babies just like it in there.',
    body: 'Extra check-ins now — reassurance for everyone.',
  },
  milestones: [
    {
      id: 'past-due',
      label: 'Past the due date',
      weekOffset: 0,
      tone: 'inform',
      copy: 'Past the due date — common and well-charted. Extra check-ins reassure.',
    },
  ],
  prep: LATE_PREP,
  nextWeekTeaser: 'Next week: 42 weeks — most providers plan the arrival by now.',
  delight: {
    factIds: ['hiccups', 'cord-slack', 'amniotic-pool'],
    freshAngles: ['Cozy a little longer', 'Well-charted territory'],
  },
  routineSeeds: {
    baby: [
      'They\'re still growing, a little more plump each day.',
      'The placenta gets monitored more closely now. It\'s routine and reassuring.',
      'They\'re running out of room to move, but they\'ll try anyway.',
    ],
    body: [
      'Non-stress tests or biophysical profiles may be scheduled. They\'re simple, painless check-ins.',
      'Impatience is universal. It helps to be impatient together.',
      'Rest when you can. The finale is physical work.',
    ],
    know: [
      'Most providers recommend planning the birth by 42 weeks.',
      'Induction methods are a personal conversation with your provider.',
    ],
    tips: [
      'Keep the bag packed and the phone charged, still.',
      'Long walks are the classic suggestion. Do what feels right.',
    ],
  },
  firstTimeNote:
    'Being "overdue" sounds alarming but it\'s mostly waiting with extra check-ins — very routine.',
  experiencedNote:
    'You know this stretch is more boring than scary — extra appointments, same waiting.',
  quietDay: { lookbackEligible: true },
};

const ROW_42: WeekMatrixRow = {
  week: 42,
  anchors: {
    baby: '42 weeks, the far edge of the calendar. Arrival is planned by now.',
    body: 'The longest wait — nearly over.',
  },
  milestones: [
    {
      id: 'week-42',
      label: '42 weeks',
      weekOffset: 0,
      tone: 'inform',
      copy: '42 weeks — the far edge. Most providers and parents have a plan by now.',
    },
  ],
  prep: LATE_PREP,
  nextWeekTeaser: undefined,
  delight: {
    factIds: ['placenta', 'flavors-amniotic', 'swallowing-practice'],
    freshAngles: ['The far edge', 'Nearly over'],
  },
  routineSeeds: {
    baby: [
      'They\'re fully developed now, just waiting for the right moment.',
      'Extra monitoring continues, so everyone is watched closely.',
      'The plan for their arrival is made together with your provider.',
    ],
    body: [
      'You\'re at the very end of the longest wait.',
      'Trust the plan you made with your care team.',
      'Soon this will be a story you tell.',
    ],
    know: [
      'Post-term (past 42 weeks) is uncommon — plans are usually made before now.',
      'Your care team\'s guidance is the map here.',
    ],
    tips: [
      'You\'re almost there. Really.',
      'One day, very soon, you\'ll hold them.',
    ],
  },
  firstTimeNote:
    'Almost no one gets here without a plan — you\'re in close contact with your provider now.',
  experiencedNote:
    'The final wait. You know the drill — and the reward.',
  quietDay: { lookbackEligible: false },
};

/* ------------------------------------------------------------------ */
/* Fallback row — safe, generic, general-info copy for weeks awaiting   */
/* curation. Never undefined, never scary, never specific claims.       */
/* ------------------------------------------------------------------ */

export const FALLBACK_ROW: WeekMatrixRow = {
  week: 0,
  anchors: {
    baby: '{Name} is growing every day. Length, weight, and new refinements.',
    body: 'Your body is doing remarkable, ordinary work.',
  },
  milestones: [],
  prep: [],
  nextWeekTeaser: undefined,
  delight: {
    factIds: [],
    freshAngles: [],
  },
  routineSeeds: {
    baby: [
      'Growth is the theme. Every week adds size and new refinements.',
      'Their systems are developing on their own remarkable schedule.',
    ],
    body: [
      'Your body is adapting beautifully to its extraordinary task.',
      'Rest when you need it. Growing a person is real work.',
    ],
    know: [
      'Every week brings something new — your briefing keeps pace.',
      'General information, always — your care team has the personal answers.',
    ],
    tips: [
      'Small comforts count double right now.',
      'Keep water nearby and rest without guilt.',
    ],
  },
  quietDay: { lookbackEligible: true },
};

const CURATED: Record<number, WeekMatrixRow> = {
  4: ROW_4,
  5: ROW_5,
  6: ROW_6,
  7: ROW_7,
  8: ROW_8,
  9: ROW_9,
  10: ROW_10,
  11: ROW_11,
  12: ROW_12,
  13: ROW_13,
  14: ROW_14,
  15: ROW_15,
  16: ROW_16,
  17: ROW_17,
  18: ROW_18,
  19: ROW_19,
  20: ROW_20,
  21: ROW_21,
  22: ROW_22,
  23: ROW_23,
  24: ROW_24,
  25: ROW_25,
  26: ROW_26,
  27: ROW_27,
  28: ROW_28,
  29: ROW_29,
  30: ROW_30,
  31: ROW_31,
  32: ROW_32,
  33: ROW_33,
  34: ROW_34,
  35: ROW_35,
  36: ROW_36,
  37: ROW_37,
  38: ROW_38,
  39: ROW_39,
  40: ROW_40,
  41: ROW_41,
  42: ROW_42,
};

/** Weeks with fully curated rows (staged curation — backfill the rest). */
export const CURATED_WEEKS: readonly number[] = Object.keys(CURATED)
  .map(Number)
  .sort((a, b) => a - b);

/** The matrix row for a week — the fallback row when not yet curated. Never undefined. */
export function getMatrixRow(week: number): WeekMatrixRow {
  return CURATED[week] ?? { ...FALLBACK_ROW, week };
}

/** True when the week has a fully curated row (not the fallback). */
export function hasCuratedRow(week: number): boolean {
  return week in CURATED;
}

/**
 * Prep entries active in a given week, from the approved window set.
 * Used for fallback weeks (curated rows carry their own prep lists).
 */
export function activePrepForWeek(week: number): MatrixPrep[] {
  const all = [PREP_HOSPITAL_BAG, PREP_BIRTH_PLAN, PREP_PEDIATRICIAN, PREP_CAR_SEAT];
  return all.filter((p) => week >= p.window[0] && week <= p.window[1]);
}
