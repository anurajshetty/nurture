/**
 * On-device intent detection for the universal composer (Epic 2.1).
 *
 * Pure keyword rules — no LLM, no network, works offline. Parsing the
 * text only ever PRODUCES a proposal; nothing is created until she taps
 * "Save". Never auto-create anything from a guess — that is a hard rule.
 */

import type { EventInput } from '../lib/types';
import { todayISO } from '../onboarding/dates';

export type IntentKind = 'symptom' | 'movement' | 'milestone' | 'appointment' | 'weight';

/**
 * Optional build context for proposals that need more than the note text.
 * Passed ONLY from an explicit "Save" tap.
 */
export interface ProposalBuildOpts {
  /** ISO date/datetime for the event's occurredAt. Defaults to today when unset. */
  occurredAt?: string;
}

export interface IntentProposal {
  kind: IntentKind;
  /** Headline for the proposal card, e.g. "Save as symptom?" */
  title: string;
  /** Warm one-liner under the headline. */
  subtitle: string;
  /** Detected labels shown as chips, e.g. ["Heartburn"]. */
  labels: string[];
  /**
   * Builds the structured event. Called ONLY from the explicit "Save"
   * tap — never speculatively.
   */
  buildEvent: (noteText: string, opts?: ProposalBuildOpts) => EventInput;
}

/** Canonical symptom name → trigger phrases (lowercase, matched as substrings). */
const SYMPTOMS: Array<{ name: string; triggers: string[] }> = [
  { name: 'Nausea', triggers: ['nausea', 'nauseous', 'queasy', 'queasiness', 'morning sickness'] },
  { name: 'Vomiting', triggers: ['vomiting', 'vomit', 'threw up', 'throwing up'] },
  { name: 'Fatigue', triggers: ['fatigue', 'exhausted', 'exhaustion', 'so tired', 'wiped out'] },
  { name: 'Headache', triggers: ['headache', 'migraine', 'head ache'] },
  { name: 'Backache', triggers: ['backache', 'back ache', 'back pain', 'lower back'] },
  { name: 'Heartburn', triggers: ['heartburn', 'acid reflux', 'reflux'] },
  { name: 'Swelling', triggers: ['swelling', 'swollen', 'puffy'] },
  { name: 'Cramps', triggers: ['cramp', 'cramps', 'cramping', 'leg cramp'] },
  { name: 'Dizziness', triggers: ['dizzy', 'dizziness', 'lightheaded', 'light-headed'] },
  { name: 'Insomnia', triggers: ['insomnia', "can't sleep", 'could not sleep', 'couldn’t sleep', 'restless night'] },
  { name: 'Bloating', triggers: ['bloating', 'bloated', 'gassy'] },
  { name: 'Constipation', triggers: ['constipat'] },
];

const MOVEMENT_TRIGGERS = [
  'kick', 'kicks', 'kicked', 'kicking',
  'flutter', 'flutters', 'fluttering',
  'movement', 'moving', 'wiggle', 'wiggles', 'wiggling', 'squirm', 'squirming',
];

const APPOINTMENT_TRIGGERS = [
  'appointment', 'ultrasound', 'checkup', 'check-up', 'check up',
  'midwife', 'ob visit', 'doctor visit', 'scan appointment',
];

const WEIGHT_RE = /(\d{2,3}(?:\.\d)?)\s?(lbs?|pounds?|kgs?|kilos?)\b/i;

/**
 * Milestone trigger phrases (Epic 4.7). Each entry is matched with word
 * boundaries, and every phrase is phrased as an unambiguous celebration
 * so appointment/symptom triggers can't shadow it: none of these contain
 * 'ultrasound', 'scan appointment', 'checkup', 'appointment', 'midwife',
 * or any symptom phrase as a substring.
 */
const MILESTONE_TRIGGERS: Array<{ title: string; triggers: string[] }> = [
  { title: 'First heartbeat', triggers: ['heard the heartbeat', 'first heartbeat'] },
  { title: 'Saw the baby', triggers: ['saw the baby', 'baby on the screen'] },
  { title: 'Picked a name', triggers: ['picked a name', 'chose a name', 'decided on a name', 'named the baby'] },
  { title: 'Nursery progress', triggers: ['nursery'] },
  { title: 'Hospital bag packed', triggers: ['packed the hospital bag', 'hospital bag is packed', 'hospital bag packed'] },
];

function normalizeWeightUnit(raw: string): 'lb' | 'kg' {
  return /^k/i.test(raw) ? 'kg' : 'lb';
}

function findSymptoms(lower: string): string[] {
  const found: string[] = [];
  for (const s of SYMPTOMS) {
    if (s.triggers.some((t) => lower.includes(t))) found.push(s.name);
  }
  return found;
}

function includesWord(lower: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`).test(lower);
}

/**
 * Parses free text and returns structured-log proposals, highest
 * confidence first. Empty array when nothing matches.
 */
export function detectIntents(text: string): IntentProposal[] {
  const lower = text.toLowerCase();
  const proposals: IntentProposal[] = [];

  const symptoms = findSymptoms(lower);
  if (symptoms.length > 0) {
    proposals.push({
      kind: 'symptom',
      title: 'Save as symptom?',
      subtitle: 'Just the facts — logged, never interpreted.',
      labels: symptoms,
      buildEvent: (noteText) => ({
        type: 'symptom',
        data: { symptoms, note: noteText },
      }),
    });
  }

  const weightMatch = WEIGHT_RE.exec(text);
  if (weightMatch) {
    const value = Number(weightMatch[1]);
    const unit = normalizeWeightUnit(weightMatch[2]);
    proposals.push({
      kind: 'weight',
      title: 'Log weight?',
      subtitle: 'A quiet trend line — no targets, no judgment.',
      labels: [`${weightMatch[1]} ${unit}`],
      buildEvent: (noteText) => ({
        type: 'weight',
        data: { value, unit, note: noteText },
      }),
    });
  }

  if (MOVEMENT_TRIGGERS.some((t) => includesWord(lower, t))) {
    proposals.push({
      kind: 'movement',
      title: 'Save as a milestone?',
      subtitle: 'Those first movements deserve their own moment.',
      labels: ['Baby on the move'],
      buildEvent: (noteText) => ({
        type: 'milestone',
        data: { title: 'Baby on the move', note: noteText },
      }),
    });
  }

  for (const m of MILESTONE_TRIGGERS) {
    if (m.triggers.some((t) => includesWord(lower, t))) {
      proposals.push({
        kind: 'milestone',
        title: 'Save as a milestone?',
        subtitle: 'Worth keeping — these are the moments you’ll look back on.',
        labels: [m.title],
        buildEvent: (noteText) => ({
          type: 'milestone',
          data: { title: m.title, note: noteText },
        }),
      });
      break;
    }
  }

  if (APPOINTMENT_TRIGGERS.some((t) => lower.includes(t))) {
    proposals.push({
      kind: 'appointment',
      title: 'Save as appointment?',
      subtitle: 'Kept with your notes and questions for the visit.',
      labels: ['Appointment'],
      // occurredAt comes from the picker's "When?" row (Composer passes it
      // in opts); defaults to today when she leaves the picker untouched.
      buildEvent: (noteText, opts) => ({
        type: 'appointment',
        occurredAt: opts?.occurredAt ?? todayISO(),
        data: { title: 'Appointment', note: noteText },
      }),
    });
  }

  return proposals;
}
