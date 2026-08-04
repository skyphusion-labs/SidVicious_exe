// package.test.mjs -- packaging contract: what we ship must boot.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('.', import.meta.url).pathname;

describe('npm + docker packaging', () => {
  it('package.json files includes ssrf-guard.mjs (bot.mjs import)', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.files).toContain('ssrf-guard.mjs');
    expect(pkg.files).toContain('bot.mjs');
    expect(existsSync(join(root, 'ssrf-guard.mjs'))).toBe(true);
  });

  it('Dockerfile copies ssrf-guard.mjs', () => {
    const df = readFileSync(join(root, 'Dockerfile'), 'utf8');
    expect(df).toMatch(/ssrf-guard\.mjs/);
  });

  it('npm pack includes ssrf-guard.mjs', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: root,
      encoding: 'utf8',
    });
    // npm pack --json prints a JSON array of package objects
    const data = JSON.parse(out);
    const files = data[0]?.files?.map((f) => f.path) ?? [];
    expect(files).toContain('ssrf-guard.mjs');
    expect(files).toContain('bot.mjs');
  });
});
