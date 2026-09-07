"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCreativeBriefStore, localDateKey } = require('../lib/creative-brief');
const { createDailyBriefEngine } = require('../services/daily-brief/daily-brief-engine');
function fixture(t, { collect, compose } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'noon-freshness-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createCreativeBriefStore(path.join(directory, 'personal-brief.json'));
  let calls = 0;
  const options = { store, collect: async () => { calls++; return collect ? collect() : { actions: [], sources: [] }; },
    compose: compose || (async () => ({ content: '## Bonjour' })),
    contextBuilder: { buildContext: () => ({ metadata: {} }) }, priorityEngine: { rank: () => [] } };
  return { store, engine: createDailyBriefEngine(options), restart: () => createDailyBriefEngine(options), calls: () => calls };
}
const today = new Date('2026-09-06T08:00:00Z');
const yesterday = { id: 'brief_2026-09-05', date: '2026-09-05', content: 'Hier' };
test('current date brief returned even when history order and lastSuccessDate are inconsistent', async t => {
  const { store, engine, calls } = fixture(t);
  const current = { id: 'brief_2026-09-06', date: '2026-09-06', content: 'Aujourd’hui' };
  store.save({ briefs: [yesterday, current], lastSuccessDate: yesterday.date });
  assert.equal(engine.getCurrent({ at: today }).current.id, current.id);
  assert.equal((await engine.generate({ at: today })).id, current.id);
  assert.equal(calls(), 0);
});
test('yesterday is historical, never current when catch-up disabled or before 07:00', t => {
  const { store, engine, calls } = fixture(t);
  store.markReady(yesterday);
  for (const options of [{ at: today, enabled: false }, { at: new Date('2026-09-06T04:59:59Z') }]) {
    const state = engine.getCurrent({ ...options, catchUp: true });
    assert.equal(state.current, null); assert.equal(state.status, 'missing');
    assert.equal(state.previous.date, yesterday.date);
  }
  assert.equal(engine.getHistorical(yesterday.date).content, 'Hier');
  assert.equal(calls(), 0);
});
test('startup after 07:00, renderer reconnect, scheduler and network reconnect dedupe ten calls', async t => {
  const { store, engine, calls } = fixture(t);
  store.markReady(yesterday, new Date('2026-09-05T08:00:00Z'));
  const states = Array.from({ length: 10 }, () => engine.getCurrent({ at: today, catchUp: true }));
  assert.ok(states.every(state => state.generationActive && !state.current));
  const results = await Promise.all(Array.from({ length: 10 }, () => engine.generate({ at: today })));
  assert.ok(results.every(brief => brief.id === 'brief_2026-09-06'));
  assert.equal(calls(), 1);
  assert.equal(store.load().briefs.filter(brief => brief.date === '2026-09-06').length, 1);
  assert.equal(engine.getCurrent({ at: today }).status, 'ready');
});
test('next-day restart rotates current while retaining same-day identity', async t => {
  const { engine, restart, store, calls } = fixture(t);
  const first = await engine.generate({ at: new Date('2026-09-05T08:00:00Z') });
  const restarted = restart();
  assert.equal(restarted.getCurrent({ at: today }).current, null);
  restarted.getCurrent({ at: today, catchUp: true });
  const second = await restarted.generate({ at: today });
  assert.notEqual(first.id, second.id);
  assert.equal((await restart().generate({ at: today })).generatedAt, second.generatedAt);
  assert.equal(store.load().briefs.length, 2); assert.equal(calls(), 2);
});
test('Europe/Paris summer and winter midnight boundaries use local date', () => {
  for (const [utc, date] of [
    ['2026-09-05T21:59:59Z', '2026-09-05'], ['2026-09-05T22:00:00Z', '2026-09-06'],
    ['2026-09-05T23:30:00Z', '2026-09-06'], ['2026-01-05T22:59:59Z', '2026-01-05'],
    ['2026-01-05T23:00:00Z', '2026-01-06'], ['2026-01-05T23:30:00Z', '2026-01-06'],
  ]) assert.equal(localDateKey(new Date(utc)), date);
});
test('generation spanning Paris midnight cannot reuse the previous day promise', async t => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const { engine, calls } = fixture(t, { collect: async () => { await wait; return { actions: [], sources: [] }; } });
  const before = engine.generate({ at: new Date('2026-09-05T21:59:59Z') });
  const after = engine.generate({ at: new Date('2026-09-05T22:00:00Z') });
  release();
  assert.equal((await before).date, '2026-09-05');
  assert.equal((await after).date, '2026-09-06'); assert.equal(calls(), 2);
});
test('failed current generation never masquerades yesterday and polling respects retry delay', async t => {
  const { engine, store, calls } = fixture(t, { collect: async () => { throw new Error('Source indisponible'); } });
  store.markReady(yesterday, new Date('2026-09-05T08:00:00Z'));
  await assert.rejects(engine.generate({ at: today }));
  const state = engine.getCurrent({ at: today, catchUp: true });
  assert.equal(state.status, 'failed'); assert.equal(state.current, null);
  assert.equal(state.previous.date, yesterday.date); assert.equal(state.generationActive, false);
  for (let i = 0; i < 10; i++) engine.getCurrent({ at: today, catchUp: true });
  assert.equal(calls(), 1);
});
test('persisted generating without an active run is not a live loading indicator', t => {
  const { engine, store } = fixture(t);
  store.markGenerating(today);
  const state = engine.getCurrent({ at: today });
  assert.equal(state.generationActive, false); assert.equal(state.status, 'failed');
  store.markReady({ date: '2026-09-06', content: 'Ready' }, today);
  store.markGenerating(today);
  assert.equal(engine.getCurrent({ at: today }).status, 'ready');
});
test('degraded current generation is PARTIAL, not yesterday or empty', async t => {
  const { engine } = fixture(t, { compose: async () => { throw new Error('Network'); } });
  await engine.generate({ at: today });
  const state = engine.getCurrent({ at: today });
  assert.equal(state.status, 'partial'); assert.equal(state.current.date, '2026-09-06');
  assert.ok(state.current.content.length);
});
test('canonical brief server wiring does not invoke external draft writes', () => {
  const source = fs.readFileSync(require.resolve('../server'), 'utf8');
  const wiring = source.slice(source.indexOf('const dailyBriefEngine ='), source.indexOf('async function generateDailyBrief'));
  assert.match(wiring, /prepareDrafts: \(\) => \[\]/);
  assert.doesNotMatch(wiring, /createGmailDraft|createCalendarEvent|updateCalendarEvent|writeFile/);
});

test('scheduler metadata cannot erase generation failure or a live attempt', t => {
  const { store, engine } = fixture(t);
  store.markGenerating(today);
  store.markScheduled(new Date('2026-09-07T05:00:00Z'));
  assert.equal(store.load().status, 'generating');
  store.markError(new Error('Interrupted'));
  store.markScheduled(new Date('2026-09-07T05:00:00Z'));
  assert.equal(engine.getCurrent({ at: today }).status, 'failed');
});
