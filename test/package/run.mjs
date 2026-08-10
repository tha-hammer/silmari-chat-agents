#!/usr/bin/env node
/**
 * B19 — the published `./baml` subpath registers, from the PACKED package.
 * [BLOCKING CLOSURE]
 *
 * This crosses the packaging boundary that B5 cannot see: B5 imports a source
 * alias (`@/llm/baml`) and stays green even when `exports`, the tsdown entry,
 * the emitted `.mjs`/`.cjs`, or the declaration path is broken. Here we build a
 * real `npm pack` tarball, install it into a scratch consumer, and drive four
 * consumers against the PUBLISHED artifacts only — no `@/` aliases, no `src/`
 * paths.
 *
 * It FAILS CLOSED. If `dist/` is missing, the tarball cannot be produced, the
 * `./baml` entry does not resolve, or any consumer exits non-zero, this exits
 * non-zero. It is never skipped to green.
 *
 * Prerequisite: `npm run build` (this reads dist/, it does not build).
 * Offline-safe: the scratch consumer resolves `@librechat/agents` to the packed
 * tarball and its transitive dependencies upward through the repo's own
 * node_modules — no network install.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const scratch = path.join(here, '.scratch');
const pkgDir = path.join(scratch, 'node_modules', '@librechat', 'agents');
const consumersSrc = path.join(here, 'consumers');
const tscBin = path.join(repoRoot, 'node_modules', '.bin', 'tsc');

/** Emitted artifacts the `exports['./baml']` map points at — all three must exist. */
const REQUIRED_ARTIFACTS = [
  'dist/esm/llm/baml/index.mjs',
  'dist/cjs/llm/baml/index.cjs',
  'dist/types/llm/baml/index.d.ts',
];

function fail(message) {
  console.error(`\n✗ B19 FAILED (closed): ${message}\n`);
  process.exit(1);
}

function step(message) {
  console.log(`• ${message}`);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...opts,
  });
}

// 1) The build must have happened. Fail closed if the artifacts are missing.
for (const rel of REQUIRED_ARTIFACTS) {
  if (!existsSync(path.join(repoRoot, rel))) {
    fail(`missing built artifact ${rel} — run \`npm run build\` first`);
  }
}
step('built ./baml artifacts present (esm + cjs + types)');

// 2) Fresh scratch consumer with its OWN name so Node self-referencing does not
//    resolve `@librechat/agents` to this repo instead of the packed tarball.
rmSync(scratch, { recursive: true, force: true });
mkdirSync(pkgDir, { recursive: true });
writeFileSync(
  path.join(scratch, 'package.json'),
  JSON.stringify(
    { name: 'baml-package-consumer', private: true, version: '0.0.0', type: 'module' },
    null,
    2,
  ),
);

// 3) Pack the real tarball (scripts skipped — build already ran) and extract it.
let tarball;
try {
  const out = run('npm', [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    scratch,
  ], { cwd: repoRoot });
  const parsed = JSON.parse(out);
  const filename = Array.isArray(parsed) ? parsed[0]?.filename : parsed?.filename;
  tarball = filename ? path.join(scratch, path.basename(filename)) : null;
} catch (err) {
  fail(`npm pack failed: ${err.message}`);
}
if (!tarball || !existsSync(tarball)) {
  // Fallback: locate the .tgz npm wrote to the scratch dir.
  const tgz = readdirSync(scratch).find((f) => f.endsWith('.tgz'));
  tarball = tgz ? path.join(scratch, tgz) : null;
}
if (!tarball || !existsSync(tarball)) {
  fail('npm pack produced no tarball');
}
step(`packed ${path.basename(tarball)}`);

try {
  run('tar', ['-xzf', tarball, '-C', pkgDir, '--strip-components=1']);
} catch (err) {
  fail(`could not extract tarball: ${err.message}`);
}

// 4) The packed package must actually ship the ./baml entry the map promises.
for (const rel of REQUIRED_ARTIFACTS) {
  if (!existsSync(path.join(pkgDir, rel))) {
    fail(`packed tarball is missing ${rel} — the ./baml entry would not resolve`);
  }
}
step('packed tarball ships the ./baml entry');

// 5) Copy the consumers into the scratch tree so they resolve `@librechat/agents`
//    to the packed tarball (and its deps upward through the repo node_modules).
cpSync(consumersSrc, scratch, { recursive: true });

const nodeConsumers = [
  ['ESM  (import ./baml side-effect + root initializeModel resolves BAML)', 'esm-consumer.mjs'],
  ['CJS  (require ./baml + root share ONE registry — dual-format proof)', 'cjs-consumer.cjs'],
  ['NEG  (root-only import leaves BAML unregistered)', 'negative-consumer.mjs'],
];

let failures = 0;
for (const [label, file] of nodeConsumers) {
  try {
    const out = run('node', [path.join(scratch, file)], { cwd: scratch });
    console.log(`  ✓ ${label}\n    ${out.trim()}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${label}\n${(err.stdout || '') + (err.stderr || err.message)}`);
  }
}

// 6) Type consumers cover the two resolution modes this library actually
//    supports, proving both the `exports.types` condition and the `typesVersions`
//    mirror for `./baml`:
//      - bundler → reads exports.types (Vite/webpack/esbuild/Bun/Next; and the
//                  repo's own tsconfig uses moduleResolution: "bundler").
//      - node10  → reads typesVersions (classic resolution).
//    Pure `nodenext` .d.ts consumption is deliberately NOT a gate: the library
//    emits extensionless relative re-exports in its barrel declarations (e.g.
//    `export * from './types'`) plus `@/` path aliases, which nodenext rejects.
//    This is LIBRARY-WIDE and pre-existing — `@librechat/agents/langchain` fails
//    nodenext identically to `./baml` — so B19 does not hold this one entry to a
//    standard no entry in the package meets. Making the whole package
//    nodenext-clean is tracked separately.
const typeChecks = [
  ['TYPE bundler (BamlClientOptions + errors via exports.types)', 'tsconfig.bundler.json'],
  ['TYPE node10  (BamlClientOptions + errors via typesVersions)', 'tsconfig.node10.json'],
];
for (const [label, tsconfig] of typeChecks) {
  try {
    run(tscBin, ['-p', path.join(scratch, tsconfig)], { cwd: scratch });
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${label}\n${(err.stdout || '') + (err.stderr || err.message)}`);
  }
}

if (failures > 0) {
  fail(`${failures} consumer(s) failed`);
}

// Leave scratch in place for post-mortem only on failure; clean on success.
rmSync(scratch, { recursive: true, force: true });
console.log('\n✓ B19 PASSED: the packed ./baml subpath registers into the one shared registry (ESM + CJS + types).');
