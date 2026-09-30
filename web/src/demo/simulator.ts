import type { DemoBackend } from './backend';
import { CALL_OUTCOME_DELAY_MS, WARNING_DELAY_MS, ingestCall, ingestClassifierError, ingestFlagged, ingestOutgoing, ingestPassed } from './engine';
import { FLAGGED_INCOMING, OUTGOING_REPLIES, PASSED_INCOMING } from './messages';
import { createRandom, type Random } from './random';
import type { DemoPerson, PersonKind } from './people';

const MIN_GAP_MS = 5_000;
const MAX_GAP_MS = 14_000;
const REPLY_DELAY_MS = 4_000;
const EXPIRY_CHECK_MS = 30_000;
const FLAGGED_SHARE = 0.22;
const CALL_SHARE = 0.06;
const ERROR_SHARE = 0.03;
const REPLY_RATE = 0.6;

type FlaggingKind = keyof typeof FLAGGED_INCOMING;
type PassingKind = Exclude<keyof typeof PASSED_INCOMING, 'banter'>;

function isFlaggingKind(kind: PersonKind): kind is FlaggingKind {
  return kind in FLAGGED_INCOMING;
}

function isPassingKind(kind: PersonKind): kind is PassingKind {
  return kind in PASSED_INCOMING && kind !== ('banter' as string);
}

function moderatedPeople(backend: DemoBackend): DemoPerson[] {
  return backend
    .allContacts()
    .filter((state) => state.monitored && !state.paused && !state.block)
    .map((state) => state.person);
}

function simulateFlagged(backend: DemoBackend, random: Random, now: number): void {
  const person = random.pick(moderatedPeople(backend).filter((candidate) => isFlaggingKind(candidate.kind)));
  if (person && isFlaggingKind(person.kind)) ingestFlagged(backend, person.id, random.pick(FLAGGED_INCOMING[person.kind]), now - WARNING_DELAY_MS, random);
}

function simulateCall(backend: DemoBackend, random: Random, now: number): void {
  const nuisance = random.chance(0.6);
  const callers = moderatedPeople(backend).filter((candidate) => (nuisance ? candidate.kind === 'harasser' : candidate.kind === 'friend' || candidate.kind === 'family'));
  const person = random.pick(callers);
  if (person) ingestCall(backend, person.id, now - CALL_OUTCOME_DELAY_MS - WARNING_DELAY_MS, random, !nuisance);
}

function simulatePassed(backend: DemoBackend, random: Random, now: number, asError: boolean): void {
  const person = random.pick(moderatedPeople(backend).filter((candidate) => isPassingKind(candidate.kind)));
  if (!person || !isPassingKind(person.kind)) return;
  const template = random.pick(PASSED_INCOMING[person.kind]);
  if (asError) {
    ingestClassifierError(backend, person.id, template.message, now, random);
    return;
  }
  ingestPassed(backend, person.id, template, now);
  if (person.kind !== 'shop' && random.chance(REPLY_RATE)) {
    const reply = random.pick(OUTGOING_REPLIES);
    setTimeout(() => ingestOutgoing(backend, person.id, reply, Date.now()), REPLY_DELAY_MS);
  }
}

function simulateOnce(backend: DemoBackend, random: Random): void {
  const now = Date.now();
  const roll = random.next();
  if (roll < FLAGGED_SHARE) simulateFlagged(backend, random, now);
  else if (roll < FLAGGED_SHARE + CALL_SHARE) simulateCall(backend, random, now);
  else simulatePassed(backend, random, now, roll < FLAGGED_SHARE + CALL_SHARE + ERROR_SHARE);
}

export function startSimulator(backend: DemoBackend): () => void {
  const random = createRandom(Date.now());
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => {
      simulateOnce(backend, random);
      schedule();
    }, random.int(MIN_GAP_MS, MAX_GAP_MS));
  };
  schedule();
  const expiry = setInterval(() => backend.expireBlocks(Date.now()), EXPIRY_CHECK_MS);
  return () => {
    clearTimeout(timer);
    clearInterval(expiry);
  };
}
