// npm run demo: runs the dashboard on made-up data, without touching any real lanes folder.
// Copies examples/demo-lanes to a temp folder, moves its timestamps up to now,
// and starts the server there (port 4318 unless PORT is set).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'examples', 'demo-lanes');
const dir = path.join(os.tmpdir(), 'claude-lanes-demo');
fs.rmSync(dir, { recursive: true, force: true });
fs.cpSync(src, dir, { recursive: true });

// Shift every ts so the newest line is two minutes old.
const files = ['updates.jsonl', 'answers.jsonl'].map((f) => path.join(dir, f));
const all = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => Date.parse(JSON.parse(l).ts)));
const shift = Date.now() - 2 * 60_000 - Math.max(...all);
for (const f of files) {
  const out = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => {
    const o = JSON.parse(l);
    o.ts = new Date(Date.parse(o.ts) + shift).toISOString();
    return JSON.stringify(o);
  });
  fs.writeFileSync(f, out.join('\n') + '\n');
}

// Status files: recent, except Lane C, which has been quiet for a while.
const ago = (min) => new Date(Date.now() - min * 60_000);
for (const [f, min] of [['coordinator.md', 4], ['lane-a.md', 6], ['lane-b.md', 25], ['lane-c.md', 150]]) {
  fs.utimesSync(path.join(dir, f), ago(min), ago(min));
}

const config = {
  port: Number(process.env.PORT || 4318),
  person: 'Sam',
  projects: [{ name: 'acme', lanesFolder: dir, prStateFile: path.join(root, 'examples', 'pr-states.json') }],
};
const configFile = path.join(dir, 'demo-config.json');
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
process.env.LANES_CONFIG = configFile;
process.env.PORT = String(config.port);
console.log(`Demo data in ${dir}`);
await import('../server.js');
