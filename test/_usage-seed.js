// Fresh Gemini usage snapshot, so tests never spawn the real `agy -p /usage` (slow, flaky, machine-dependent).
import fs from 'node:fs';
import path from 'node:path';

export function seedUsage(home) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'usage.json'), JSON.stringify({ gemini: { at: new Date().toISOString(), source: 'test' } }));
  return home;
}
