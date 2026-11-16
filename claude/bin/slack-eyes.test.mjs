import test from 'node:test'
import assert from 'node:assert/strict'
import { isAnswered, isThanks, resultSchema, wantsOpus, opusPrompt } from './slack-eyes.mjs'

const LIAM = 'U0B78R52DFT'
const REPORTER = 'U0REPORTER1'
const acks = new Set(['taking a look', 'lemme check'])
const job = (over = {}) => ({ status: 'done', ...over, hit: { ts: '100.0', own: false, ...over.hit } })
const agent = (ts, text) => ({ ts, user: LIAM, bot_id: 'B1', text })
const liam = (ts, text) => ({ ts, user: LIAM, text })
const person = (ts, text, user = REPORTER) => ({ ts, user, text })
const eyes = person('100.0', 'the page is broken')

test('the ack alone is not an answer', () => {
  assert.equal(isAnswered([eyes, agent('101.0', 'taking a look')], job(), acks), false)
})

test('an ack not in the voice file is caught by its saved ts', () => {
  assert.equal(isAnswered([eyes, agent('101.0', 'on it boss')], job({ hit: { ackTs: '101.0' } }), acks), false)
})

test('an ack with a mention and punctuation still matches the ack text', () => {
  assert.equal(isAnswered([eyes, agent('101.0', `<@${REPORTER}> Lemme check!`)], job(), acks), false)
})

test('a reply after the ack is the answer', () => {
  assert.equal(isAnswered([eyes, agent('101.0', 'taking a look'), agent('102.0', `<@${REPORTER}> fixed, refresh it`)], job(), acks), true)
})

test('a question to the reporter is not the answer', () => {
  assert.equal(isAnswered([eyes, agent('101.0', 'taking a look'), agent('102.0', 'can u send a screenshot of it?')], job(), acks), false)
})

test('a link with a ? in it does not make an answer a question', () => {
  assert.equal(isAnswered([eyes, agent('102.0', 'its here <https://app.sideshift.app/x?tab=pay|settings>')], job(), acks), true)
})

test('a job waiting on someone is never answered', () => {
  const thread = [eyes, agent('102.0', 'fixed it')]
  assert.equal(isAnswered(thread, job({ status: 'waiting_reporter' }), acks), false)
  assert.equal(isAnswered(thread, job({ status: 'board_waiting' }), acks), false)
})

test('a closing thanks keeps it answered; a new problem reopens it', () => {
  const answered = [eyes, agent('102.0', 'fixed it')]
  assert.equal(isAnswered([...answered, person('103.0', 'ty both for help!')], job(), acks), true)
  assert.equal(isAnswered([...answered, person('103.0', 'thanks, but it is still broken for me')], job(), acks), false)
  assert.equal(isAnswered([...answered, person('103.0', 'still broken'), person('104.0', 'ty', 'U0TEAMMATE1')], job(), acks), false)
})

test('a reply sent to the channel too (thread_broadcast) counts', () => {
  const answered = [eyes, agent('102.0', 'fixed it')]
  assert.equal(isAnswered([...answered, { ...person('103.0', 'how do i do it for the other brand?'), subtype: 'thread_broadcast' }], job(), acks), false)
  assert.equal(isAnswered([eyes, { ...agent('102.0', 'fixed it'), subtype: 'thread_broadcast' }], job(), acks), true)
})

test("in Liam's own DM his hand-typed posts are context, not answers", () => {
  const own = job({ hit: { own: true } })
  const mine = person('100.0', 'brand x cannot pay', LIAM)
  assert.equal(isAnswered([mine, agent('101.0', 'taking a look'), liam('102.0', 'also it started today')], own, acks), false)
  assert.equal(isAnswered([mine, agent('103.0', 'found it, fixed')], own, acks), true)
  assert.equal(isAnswered([mine, agent('103.0', 'found it, fixed'), liam('104.0', 'it is happening for brand y too')], own, acks), false)
})

test('a reply before the :eyes: message does not count (mid-thread :eyes:)', () => {
  const thread = [person('90.0', 'first issue'), agent('95.0', 'fixed the first one'), eyes]
  assert.equal(isAnswered(thread, job(), acks), false)
})

test('isThanks', () => {
  for (const t of [
    'ty both for help!', 'makes sense - thx', 'Got it. Thank you.',
    "Ok perfect! thank you! For some reason it wasn't showing us but it is now!",
    "okay i appreciate you checking on that with specifics! makes total sense- i hadn't realized",
    "Got it. So yeah it's up to them not us. Thank you. Assume some more people will give us issues",
  ]) assert.equal(isThanks(t), true, t)
  for (const t of [
    'not perfect yet', 'thanks! does it work for X too?', "thanks, didn't work", 'thanks but its still broken',
    'I was manually skipping everything', 'got it to fail again', "thanks, the page isn't loading for me",
  ]) assert.equal(isThanks(t), false, t)
})

test("each person's latest post decides: a question then the same person's thanks closes it", () => {
  const answered = [eyes, agent('102.0', 'fixed it')]
  assert.equal(isAnswered([...answered, person('103.0', 'want to confirm, both settings are on?'), person('104.0', 'ty both for help!')], job(), acks), true)
})

test('a Sonnet run may return needs_opus; an Opus run may not', () => {
  assert.ok(JSON.parse(resultSchema('sonnet')).properties.status.enum.includes('needs_opus'))
  assert.ok(!JSON.parse(resultSchema('opus')).properties.status.enum.includes('needs_opus'))
})

test('Sonnet moves to Opus on needs_opus or an unproven cause, never on a real hold', () => {
  assert.equal(wantsOpus('sonnet', { status: 'needs_opus' }), true)
  assert.equal(wantsOpus('sonnet', { status: 'needs_liam', hold_reason: 'cause_unproven' }), true)
  assert.equal(wantsOpus('sonnet', { status: 'needs_liam', hold_reason: 'large_merge_held' }), false)
  assert.equal(wantsOpus('sonnet', { status: 'done' }), false)
  assert.equal(wantsOpus('opus', { status: 'needs_liam', hold_reason: 'cause_unproven' }), false)
})

test('the Opus turn carries what the Sonnet pass found', () => {
  const text = opusPrompt({ summary: 'the invite query skips archived seats', question: 'fix the query and reply' })
  assert.match(text, /invite query skips archived seats/)
  assert.match(text, /fix the query and reply/)
})
