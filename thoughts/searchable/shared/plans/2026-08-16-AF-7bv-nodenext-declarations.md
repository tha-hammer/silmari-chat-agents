---
date: 2026-08-16T12:27:00-04:00
planner: GentleRiver
git_commit: 2b41826d40d36af36c43150af497f8c1ebfe57aa
branch: nodenext-library-2026-08-16-12-15
repository: silmari-chat-agents
bead: AF-7bv
status: reviewed
review: thoughts/searchable/shared/plans/2026-08-16-AF-7bv-nodenext-declarations-REVIEW.md
review_verdict: needs-major-revision-addressed
last_updated: 2026-08-16
last_updated_by: GentleRiver
---

# AF-7bv NodeNext-compatible declarations implementation plan

## Overview

Make every declaration emitted into the published `dist/types` tree consumable under TypeScript's NodeNext and Node16 resolution rules. The build will rewrite source-only `@/` aliases and extensionless first-party declaration specifiers before packaging, then B19 will compile a real packed-package consumer across all 14 public export entries.

## Current State Analysis

- Runtime files and declaration files use separate producers. `tsdown` rewrites runtime paths, while `tsc -p tsconfig.build.json` emits declarations without a post-processing step (`package.json:129`, `tsdown.config.mjs:9-20`).
- The declaration compiler resolves source aliases through `@/* -> ./src/*` under bundler resolution and preserves those specifiers in output (`tsconfig.json:13-16`, `tsconfig.build.json:2-9`).
- A real packed-package probe reports exactly 5/14 failing public entries: root, `./langchain`, `./baml`, `./openai`, and `./responses`. The nine direct `./langchain/*` facades pass.
- The generated tree has 113 files with `@/` specifiers and 63 files with relative specifiers. The work is therefore a full declaration-tree build concern, not five source-file edits.
- `tsc-alias` is already installed but unused. Its default replacer resolves `@/` aliases. Its stock full-path option does not append `.js` in a declaration-only output tree because it checks for sibling `.js` files rather than `.d.ts` targets.
- B19 packs the real package and runs runtime plus bundler/node10 type consumers, but `test/package/run.mjs:154-160` explicitly excludes NodeNext and no NodeNext/Node16 configs exist.

## Desired End State

After `npm run build`:

1. No emitted `dist/types/**/*.d.ts` module specifier starts with `@/`.
2. Every first-party relative declaration specifier is explicit Node ESM syntax:
   - declaration file target: `./name.js`;
   - declaration directory target: `./name/index.js`;
   - already explicit `.js`, `.mjs`, `.cjs`, `.json`, or `.node`: unchanged.
3. An alias or relative target the post-processor cannot resolve fails the build rather than shipping unchanged.
4. A tarball installed in B19's scratch consumer compiles with both NodeNext and Node16 across all 14 `package.json.exports` subpaths.
5. Existing packed ESM/CJS behavior and bundler/node10 type consumers remain green.

## Locked Decisions

### D1. Post-process emitted declarations; do not rewrite source imports

Changing 141 extensionless source barrel exports would expand the change across unrelated runtime and test surfaces. Declaration compatibility belongs in the existing declaration-only branch immediately after `tsc`.

### D2. Use one `tsc-alias` rewrite invocation with a declaration-aware custom replacer

The installed default replacer remains the single source of truth for the repository's `paths` mapping. A custom replacer, loaded after the default replacer, handles only the declaration-specific Node ESM extension contract. Alias and extension rewriting therefore happen in one `tsc-alias` traversal. A separate read-only output audit is an intentional postcondition gate, not a second rewrite.

The exact `tsconfig.build.json` contract is:

```json
{
  "tsc-alias": {
    "replacers": {
      "declaration-imports": {
        "enabled": true,
        "file": "./config/declaration-import-replacer.cjs"
      }
    }
  }
}
```

For a generic custom key, `tsc-alias@1.8.10` resolves this file from `process.cwd()`. `npm run build` therefore owns repository-root CWD as part of the connector contract.

### D3. The custom replacer is fail-closed

The installed `AliasReplacer` API calls `declarationImportReplacer({ orig, file, config })`, where `orig` is the complete matched import/export/module statement. The replacer extracts the quoted module path, rewrites only that path, and returns the complete statement. Because the 1.8.10 loader reads only `replacerModule.default`, the CommonJS module exports `module.exports.default = declarationImportReplacer`.

After the default alias pass, the extracted specifier follows this grammar:

```text
specifier = bare | source-alias | relative-explicit | relative-extensionless

bare                   -> identity
source-alias "@/..."   -> error (default alias rewrite did not resolve it)
relative-explicit      -> identity
relative + file.d.ts   -> relative + ".js"
relative + index.d.ts  -> relative + "/index.js"
relative + no target   -> error
```

File resolution uses the current emitted declaration's directory and real sibling `.d.ts` paths. Bad paths are handled with guard clauses; no condition contains side effects or mutation.

The stock custom-loader diagnostic is nonfatal. The build is made fail-closed in two independent ways: the output audit requires the custom module and asserts that its `.default` export is a function, and then scans the entire declaration tree after rewriting. A missing file, invalid export, residual alias, extensionless relative edge, or unresolved explicit first-party edge makes `npm run build` exit non-zero.

### D4. Test the published boundary and the transformer contract

- A small `node:test` suite exercises the real custom replacer with real temporary `.d.ts` files: file targets, directory indexes, already explicit paths, bare dependencies, residual aliases, and unresolved relatives.
- One integration case invokes the installed `tsc-alias` loader against a temporary declaration tree from repository-root CWD. It begins with an `@/` statement and asserts the final relative `.js` form, proving the configured `.default` export and default-before-custom order.
- B19 remains the blocking closure. It builds no fixtures from source aliases: it packs the actual output, extracts it, and invokes the repository's real TypeScript binary against the installed package.
- The all-exports fixture imports each public subpath as a type namespace. Both NodeNext and Node16 configs set `files: ["type-consumer.ts", "all-exports-consumer.mts"]` and keep `skipLibCheck: false`, proving all 14 subpaths and AF-sy8's existing named BAML contract together.

### D5. Audit the complete output tree independently

`config/declaration-output-audit.cjs` uses the installed TypeScript parser to inspect module-specifier string literals throughout every emitted `.d.ts` file. It rejects `@/`, extensionless first-party relatives, and explicit first-party paths without real declaration targets. The build invokes this audit after `tsc-alias`, so declarations outside the 14 public entry closures cannot silently retain source-only paths.

## What We're NOT Doing

- No edits to the nine clean `src/langchain/*` leaf facade files.
- No source-wide conversion to `.js` specifiers.
- No changes to runtime ESM/CJS export paths or `typesVersions` mappings.
- No new dependency or package-lock update; `tsc-alias` is already present.
- No BAML implementation changes. `AF-sy8` owns BAML-specific acceptance and closes after the shared build mechanism is available.
- No Langfuse graph, callbacks, provider, streaming, or trace-shaping changes.

## Workflow Closure

**Promise**: a host installing the packed package can type-check every public export with NodeNext/Node16.

**Classification**: BLOCKING. The behavior crosses declaration-build and npm-package boundaries.

- **SOURCE**: repository TypeScript sources selected by `tsconfig.build.json`.
- **TRIGGER**: `npm run build` (the highest changed connector).
- **FORBIDDEN SPAN**: declaration emit, alias rewrite, extension rewrite, package creation, extraction, and package export resolution. The closure test does not call the replacer directly or seed `dist/types`.
- **OBSERVABLE**: exit status from the real `tsc` processes launched by `test/package/run.mjs` against the extracted tarball.
- **DRIVERS**: none; every edge is synchronous.
- **Red-at-seam**: with NodeNext/Node16 consumers enabled and the post-processor absent, B19 fails on the current five entries.
- **Positive control**: existing bundler/node10 consumers and packed ESM/CJS consumers stay green throughout.

## Phase 1: Red — lock the declaration and package contracts

### Behavior 1.1: extensionless and residual alias specifiers are rejected

Given real temporary declaration targets, when the custom replacer contract is exercised, then file targets become `.js`, directory targets become `/index.js`, supported explicit extensions and bare packages remain unchanged, and residual `@/` or missing relatives throw.

**Files**:

- Add `config/declaration-import-replacer.test.mjs`.
- Add `config/declaration-output-audit.cjs` and cover its full-tree success/failure behavior from the same test suite.
- Add the `test:declarations` package script and include it in `test:package`.

**Red verification**:

```bash
node --test config/declaration-import-replacer.test.mjs
```

The suite initially fails because `config/declaration-import-replacer.cjs` does not exist.

### Behavior 1.2: the packed 14-export matrix fails under NodeNext/Node16 today

Given B19's extracted tarball, when TypeScript compiles the all-exports consumer under NodeNext or Node16, then the current build fails on root, BAML, OpenAI, Responses, and LangChain declarations.

**Files**:

- Add `test/package/consumers/all-exports-consumer.mts` with all 14 export specifiers.
- Add `test/package/consumers/tsconfig.nodenext.json`.
- Add `test/package/consumers/tsconfig.node16.json`, extending the same strict consumer contract and changing only `module`/`moduleResolution`.
- Update `test/package/run.mjs` to replace the exclusion comment with two real type-check matrix entries.

Both new configs explicitly compile:

```json
"files": ["type-consumer.ts", "all-exports-consumer.mts"]
```

B19 labels both checks as the all-exports plus named-BAML contracts.

**Red verification**:

```bash
npm run build
npm run test:package
```

Expected Red: runtime, bundler, and node10 consumers pass; NodeNext and Node16 fail on emitted first-party declaration specifiers.

## Phase 2: Green — make declaration emit Node ESM compatible

### Behavior 2.1: one post-emit invocation rewrites the full declaration tree

Given TypeScript's declaration output, when the build invokes `tsc-alias`, then its default replacer resolves `@/` aliases and the custom replacer makes every relative first-party specifier explicit.

**Files**:

- Add `config/declaration-import-replacer.cjs` with one exported replacer and small pure path/specifier helpers.
- Export the replacer as `module.exports.default`, implement the exact `{ orig, file, config }` API, and always return the complete statement.
- Add the exact enabled `tsc-alias.replacers.declaration-imports` configuration from D2 to `tsconfig.build.json`.
- Add `config/declaration-output-audit.cjs`; it first validates the replacer's `.default` export and then audits all emitted declarations through the TypeScript AST.
- Update `package.json` `build` to run `tsc-alias -p tsconfig.build.json` immediately after declaration emit, then run the full-tree audit. Both commands run from the repository root.

**Green verification**:

```bash
node --test config/declaration-import-replacer.test.mjs
npm run build
npm run test:package
```

Expected Green: all seven packed consumers pass (three runtime, bundler, node10, NodeNext, Node16).

## Phase 3: Refactor and regression gates

### Behavior 3.1: build output is deterministic and clean across supported consumers

Run the build twice, generate sorted SHA-256 manifests of `dist/types`, and diff them before running the package gate. Keep the replacer flat and name all supported extensions and declaration suffixes as constants.

**Automated verification**:

```bash
npm run build
af_7bv_verify_dir=$(mktemp -d)
find dist/types -type f -name '*.d.ts' -print0 | sort -z | xargs -0 sha256sum > "$af_7bv_verify_dir/first.sha256"
npm run build
find dist/types -type f -name '*.d.ts' -print0 | sort -z | xargs -0 sha256sum > "$af_7bv_verify_dir/second.sha256"
diff -u "$af_7bv_verify_dir/first.sha256" "$af_7bv_verify_dir/second.sha256"
node config/declaration-output-audit.cjs dist/types
npm run test:package
npx tsc --noEmit
npx eslint src/ config/declaration-import-replacer.cjs config/declaration-output-audit.cjs config/declaration-import-replacer.test.mjs
npx jest langfuse deterministic-trace-id
npm audit
git status --short
```

The Langfuse smoke is included as a regression check only; no tracing code is changed.

**Manual verification**:

- Inspect `dist/types/index.d.ts`, `dist/types/langchain/index.d.ts`, `dist/types/openai/index.d.ts`, and `dist/types/responses/index.d.ts` for explicit relative `.js`/`index.js` paths and no `@/` aliases.
- Confirm the B19 output names all four type modes and reports a final pass.
- Confirm `package-lock.json` is unchanged.

## File Inventory

| File | Action | Contract |
|---|---|---|
| `config/declaration-import-replacer.cjs` | Add | Fail-closed declaration relative-specifier transformer |
| `config/declaration-import-replacer.test.mjs` | Add | Real-file unit coverage for transformer grammar |
| `config/declaration-output-audit.cjs` | Add | Fatal loader/export check and AST audit of the complete declaration tree |
| `tsconfig.build.json` | Modify | Register custom replacer after the default alias replacer |
| `package.json` | Modify | Invoke post-emit rewrite; expose test script |
| `test/package/consumers/all-exports-consumer.mts` | Add | Import all 14 published type entries |
| `test/package/consumers/tsconfig.nodenext.json` | Add | Strict NodeNext consumer |
| `test/package/consumers/tsconfig.node16.json` | Add | Strict Node16 consumer |
| `test/package/run.mjs` | Modify | Make NodeNext/Node16 members of B19's real matrix |
| `package-lock.json` | No change | No dependency change |

## Success Criteria

### Automated

- [ ] Unit Red observed before implementation.
- [ ] Packed NodeNext/Node16 Red observed before implementation.
- [ ] Replacer unit suite passes.
- [ ] `npm run build` exits 0 with no unresolved declaration specifier.
- [ ] The installed loader integration proves `@/types` becomes a relative `.js` specifier through default-then-custom ordering.
- [ ] The full `dist/types/**/*.d.ts` AST audit finds no `@/`, extensionless first-party relative, or unresolved explicit first-party specifier.
- [ ] Sorted declaration checksums are identical across two clean builds.
- [ ] `npm run test:package` passes ESM, CJS, negative runtime, bundler, node10, NodeNext, and Node16 consumers.
- [ ] All 14 public export subpaths pass the packed NodeNext/Node16 consumer.
- [ ] Both NodeNext and Node16 compile `type-consumer.ts` and `all-exports-consumer.mts` with `skipLibCheck: false`.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] ESLint exits 0 for touched JS/MJS and `src/` has no new diagnostics.
- [ ] `npm audit` reports zero vulnerabilities.

### Manual

- [ ] Representative root, LangChain, OpenAI, and Responses declarations contain only publishable specifiers.
- [ ] The BAML entry is transformed by the shared mechanism without BAML source edits.
- [ ] The nine previously clean leaf declarations remain content-equivalent except for formatting-free identity output.

## Review Amendments

| Review finding | Plan response |
|---|---|
| Critical: named BAML contract absent from new Node modes | D4, Phase 1, and automated criteria now require both configs to compile both fixtures. |
| Critical: wrong/underspecified `tsc-alias` API and loader contract | D2-D3 lock `{ orig, file, config }`, complete-statement return, `.default` export, exact config/CWD, real-loader integration, and fatal postconditions. |
| Warning: determinism had no oracle | Phase 3 now diffs sorted SHA-256 manifests from two builds. |
| Warning: production lint/full-tree scope incomplete | Phase 3 lints both production CJS files and runs an AST audit over every emitted declaration. |

## References

- Research: `thoughts/searchable/shared/research/2026-08-16-12-24-AF-7bv-nodenext-declaration-emit.md`
- Independent packed probe: `thoughts/searchable/shared/research/2026-08-16-16-21-nodenext-exports-probe.md`
- Beads: `AF-7bv`; dependent subset `AF-sy8`
