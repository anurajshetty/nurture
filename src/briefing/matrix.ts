/**
 * The 40-week content matrix — the source of truth for Home v1.1.
 *
 * One curated row per gestational week (4–42). Human-reviewed; the LLM
 * never invents facts, it only phrases what's here. See
 * HOME_ROADMAP_PROPOSAL.md §2 for the full design.
 *
 * STAGED CURATION (Anuraj, Sept 2026): weeks 36–42 are fully curated
 * first; all other weeks use FALLBACK_ROW — safe, generic, general-info
 * copy — until they are backfilled in reverse-priority order. The engine
 * degrades gracefully: `getMatrixRow()` never returns undefined.
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
export const MATRIX_REVIEW_DATE = '2026-09-19';

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
      'She\'s likely head-down now, settling into place for her arrival.',
    ],
    body: [
      'Weekly check-ins often start now. They\'re usually short and reassuring.',
      'Sleep is choppy. Rest when you can, without guilt.',
      'Braxton Hicks may be more noticeable now. It\'s a tightening feeling that comes and goes.',
    ],
    know: [
      'Group B strep screening usually happens around 36–37 weeks — a quick swab, nothing more.',
      'Kick counts: many providers suggest keeping an eye on her usual pattern.',
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
      'She\'s gaining steadily, about half a pound a week.',
      'Vernix is mostly gone, and her skin is smoothing out.',
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
    baby: '{Name}\'s grip is strong now. She\'ll wrap those tiny fingers around yours.',
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
      'Her organs are ready, and she\'s mostly gaining weight now.',
      'Her grip reflex is strong now, ready to wrap around your finger.',
      'Her brain is still developing quickly.',
    ],
    body: [
      'Trouble sleeping is pretty common now. Naps count.',
      'You might feel her drop lower. That\'s the "lightening" everyone talks about.',
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
    '"Lightening" — when she drops lower — can make breathing easier and walking stranger, both at once.',
  experiencedNote:
    'You remember the restless nights. This time, try the things that worked last time sooner — you already know your tricks.',
  quietDay: { lookbackEligible: true },
};

const ROW_39: WeekMatrixRow = {
  week: 39,
  anchors: {
    baby: 'Full term. {name} is ready whenever she is. The grand finale.',
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
    freshAngles: ['Celebrating the long build', 'Ready whenever she is'],
  },
  routineSeeds: {
    baby: [
      'At full term, every system is ready for the outside world.',
      'She\'s about 20 inches long and a little over 7 pounds.',
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
    baby: 'The due date is {name}\'s estimated arrival. She\'ll come on her own schedule.',
    body: 'You\'ve carried her 40 weeks — an extraordinary, ordinary miracle.',
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
  nextWeekTeaser: 'Next week: if she\'s still cozy, extra check-ins keep everyone reassured.',
  delight: {
    factIds: ['vernix', 'skull-soft', 'blood-type-bones'],
    rotatingBoost: ['partner'],
    freshAngles: ['The estimated day', 'Celebrating 40 weeks of work'],
  },
  routineSeeds: {
    baby: [
      'She\'s fully ready, just waiting for the right moment.',
      'Around 20 inches long and 7½ pounds. A classic newborn size.',
      'Her skull is still soft and flexible. That helps with the birth itself.',
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
    'If she\'s not here yet, that\'s normal — nearly half of first babies arrive after 40 weeks.',
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
      'She\'s still growing, a little more plump each day.',
      'The placenta gets monitored more closely now. It\'s routine and reassuring.',
      'She\'s running out of room to move, but she\'ll try anyway.',
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
      'She\'s fully developed now, just waiting for the right moment.',
      'Extra monitoring continues, so everyone is watched closely.',
      'The plan for her arrival is made together with your provider.',
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
      'One day, very soon, you\'ll hold her.',
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
      'Her systems are developing on their own remarkable schedule.',
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
