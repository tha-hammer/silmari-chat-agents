import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const replacerPath = join(
  repositoryRoot,
  'config',
  'declaration-import-replacer.cjs'
);
const auditPath = join(
  repositoryRoot,
  'config',
  'declaration-output-audit.cjs'
);
const { default: declarationImportReplacer } = require(replacerPath);
const { auditDeclarationTree } = require(auditPath);

const config = {
  output: {
    debug() {},
  },
};

async function createDeclarationFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agents-declarations-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const entry = join(root, 'nested', 'entry.d.ts');
  await mkdir(dirname(entry), { recursive: true });
  await mkdir(join(root, 'directory'), { recursive: true });
  await writeFile(join(root, 'target.d.ts'), 'export interface Target {}\n');
  await writeFile(
    join(root, 'directory', 'index.d.ts'),
    'export interface Directory {}\n'
  );
  await writeFile(entry, 'export {};\n');
  return { entry, root };
}

function replace(orig, file) {
  return declarationImportReplacer({ orig, file, config });
}

test('rewrites declaration file and directory targets using complete statements', async (t) => {
  const { entry } = await createDeclarationFixture(t);

  assert.equal(
    replace("export * from '../target'", entry),
    "export * from '../target.js'"
  );
  assert.equal(
    replace("import type { Directory } from '../directory'", entry),
    "import type { Directory } from '../directory/index.js'"
  );
});

test('preserves bare packages and supported explicit relative extensions', async (t) => {
  const { entry } = await createDeclarationFixture(t);
  const statements = [
    "export * from '@langchain/core/runnables'",
    "export * from '../target.js'",
    "export * from '../target.mjs'",
    "export * from '../target.cjs'",
    "export * from '../target.json'",
    "export * from '../target.node'",
  ];

  for (const statement of statements) {
    assert.equal(replace(statement, entry), statement);
  }
});

test('rejects residual aliases and unresolved first-party relatives', async (t) => {
  const { entry } = await createDeclarationFixture(t);

  assert.throws(
    () => replace("export * from '@/types'", entry),
    /unresolved source alias.*@\/types/i
  );
  assert.throws(
    () => replace("export * from '../missing'", entry),
    /declaration target.*missing/i
  );
});

test('loads through tsc-alias and runs the default replacer before the custom replacer', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agents-tsc-alias-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const outputRoot = join(root, 'dist');
  const entry = join(outputRoot, 'consumer', 'index.d.ts');
  await mkdir(dirname(entry), { recursive: true });
  await mkdir(join(outputRoot, 'src'), { recursive: true });
  await writeFile(entry, "export type { PublicType } from '@/types';\n");
  await writeFile(
    join(outputRoot, 'src', 'types.d.ts'),
    'export interface PublicType {}\n'
  );
  await writeFile(
    join(root, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          baseUrl: '.',
          outDir: './dist',
          paths: { '@/*': ['src/*'] },
        },
        'tsc-alias': {
          replacers: {
            'declaration-imports': {
              enabled: true,
              file: './config/declaration-import-replacer.cjs',
            },
          },
        },
      },
      null,
      2
    )}\n`
  );

  await execFileAsync(
    process.execPath,
    [
      join(
        repositoryRoot,
        'node_modules',
        'tsc-alias',
        'dist',
        'bin',
        'index.js'
      ),
      '-p',
      join(root, 'tsconfig.json'),
    ],
    { cwd: repositoryRoot }
  );

  assert.equal(
    await readFile(entry, 'utf8'),
    "export type { PublicType } from '../src/types.js';\n"
  );
});

test('audits every declaration module specifier in a clean tree', async (t) => {
  const { root } = await createDeclarationFixture(t);
  await writeFile(join(root, 'clean.d.ts'), "export * from './target.js';\n");
  assert.doesNotThrow(() => auditDeclarationTree(root));
});

test('audit rejects residual aliases, extensionless paths, and missing explicit targets', async (t) => {
  const cases = [
    ["export * from '@/types';\n", /unresolved source alias.*@\/types/i],
    [
      "export * from './target';\n",
      /extensionless declaration specifier.*target/i,
    ],
    ["export * from './missing.js';\n", /declaration target.*missing/i],
  ];

  for (const [source, expected] of cases) {
    await t.test(source.trim(), async (subtest) => {
      const { root } = await createDeclarationFixture(subtest);
      await writeFile(join(root, 'dirty.d.ts'), source);
      assert.throws(() => auditDeclarationTree(root), expected);
    });
  }
});

test('audit keeps Node declaration extensions paired with their runtime extensions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agents-declaration-pairs-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(join(root, 'module.d.mts'), 'export interface Module {}\n');
  await writeFile(join(root, 'common.d.cts'), 'export interface Common {}\n');
  await writeFile(
    join(root, 'valid.d.ts'),
    "export * from './module.mjs';\nexport * from './common.cjs';\n"
  );
  assert.doesNotThrow(() => auditDeclarationTree(root));

  await writeFile(join(root, 'invalid.d.ts'), "export * from './module.js';\n");
  assert.throws(
    () => auditDeclarationTree(root),
    /declaration target.*module\.js/i
  );
});
