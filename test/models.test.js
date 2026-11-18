import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTranscript, modelLabel, findModels } from '../lib/models.js';

const line = (o) => JSON.stringify(o);
const T = [
  line({ type: 'custom-title', customTitle: 'Lane A', sessionId: 's1' }),
  line({ type: 'agent-name', agentName: 'Lane A', sessionId: 's1' }),
  line({ type: 'assistant', message: { model: 'claude-sonnet-4-5-20250929', content: [] } }),
  line({ type: 'user', message: { content: 'tool output with "model":"claude-fake-9-9" inside' } }),
  line({ type: 'assistant', message: { model: '<synthetic>', content: [] } }),
  line({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [] } }),
  '{"type":"assistant","message":{"model":"claude-cut-',
].join('\n');

test('transcript: name and latest real model', () => {
  assert.deepEqual(readTranscript(T), { name: 'Lane A', model: 'claude-opus-5-5' });
  assert.deepEqual(readTranscript('not json\n{}'), { name: null, model: null });
});

test('model labels', () => {
  assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelLabel('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(modelLabel('claude-3-5-haiku-20241022'), 'Haiku 3.5');
  assert.equal(modelLabel('claude-opus-4-20250514'), 'Opus 4');
  assert.equal(modelLabel('something-else'), 'something-else');
});

test('findModels: newest transcript per wanted name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-models-'));
  const write = (sub, file, text, ageMin) => {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
    const f = path.join(dir, sub, file);
    fs.writeFileSync(f, text);
    const t = new Date(Date.now() - ageMin * 60_000);
    fs.utimesSync(f, t, t);
  };
  const tx = (name, model) => [line({ type: 'agent-name', agentName: name }), line({ type: 'assistant', message: { model } })].join('\n');
  write('p1', 'old.jsonl', tx('Lane A', 'claude-sonnet-4-5'), 60);
  write('p1', 'new.jsonl', tx('Lane A', 'claude-opus-5-5'), 5);
  write('p2', 'c.jsonl', tx('Coordinator', 'claude-haiku-5-5'), 10);
  write('p2', 'other.jsonl', tx('Someone else', 'claude-opus-5-5'), 1);
  write('p3', 'ancient.jsonl', tx('Lane B', 'claude-opus-5-5'), 60 * 72);
  const got = await findModels(dir, ['Coordinator', 'Lane A', 'Lane B']);
  assert.deepEqual(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.label])), { 'Lane A': 'Opus 5.5', Coordinator: 'Haiku 5.5' });
  assert.deepEqual(await findModels(path.join(dir, 'missing'), ['Lane A']), {});
  fs.rmSync(dir, { recursive: true, force: true });
});
