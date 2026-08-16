---
date: 2026-08-16T12:29:00-04:00
planner: ChartreusePuma
git_commit: 2b41826d40d36af36c43150af497f8c1ebfe57aa
branch: nodenext-library-2026-08-16-12-15
repository: silmari-chat-agents
bead: AF-sy8
depends_on: AF-7bv
status: draft
last_updated: 2026-08-16
last_updated_by: ChartreusePuma
---

# AF-sy8 NodeNext-compatible `./baml` declarations implementation plan

## Overview

Close the BAML-specific subset of the library-wide declaration defect after `AF-7bv` lands its shared post-emit rewrite. The `./baml` declaration entry and every public declaration it reaches must be consumable from a real packed package under NodeNext and Node16, while the existing bundler/node10 and ESM/CJS B19 consumers remain green.

This plan does not create a second BAML-only transformer. It applies and verifies AF-7bv's one full-tree declaration mechanism against the named BAML port/error surface that the all-exports namespace probe alone does not exercise.

## Current State Analysis

- `package.json:17-20,83-87` routes modern and classic BAML type consumers to `dist/types/llm/baml/index.d.ts`.
- The emitted BAML barrel contains three extensionless relative specifiers at `dist/types/llm/baml/index.d.ts:1,3,4`.
- Its reachable declarations retain private aliases: `ChatBAML.d.ts:10-12`, `errors.d.ts:1`, `types.d.ts:2-3`, and `toolBinding.d.ts:2-3`.
- TypeScript 5.5.3 exits non-zero under both NodeNext and Node16. The public consumer reports all nine imported BAML values/types as missing; declaration checking also exposes the three underlying `TS2834` barrel failures.
- B19 packs the real package and already proves ESM/CJS registration, root-only non-registration, bundler `exports.types`, and node10 `typesVersions` behavior (`test/package/run.mjs:66-173`). It explicitly excludes NodeNext today.
- AF-7bv's reviewed implementation owns the shared declaration transformer, the all-14-export namespace fixture, the NodeNext/Node16 configs, and the package-gate wiring. AF-sy8 owns the BAML named-surface acceptance after that prerequisite exists.

## Desired End State

After the AF-7bv build mechanism runs:

1. `dist/types/llm/baml/index.d.ts` points to `./ChatBAML.js`, `./errors.js`, and `./types.js`.
2. Every declaration reachable from that entry contains no `@/` specifier and uses explicit `.js` or `/index.js` for first-party relative declaration targets.
3. The existing no-cast BAML port fixture compiles from the packed package under NodeNext and Node16 through `exports.types`.
4. The existing node10 consumer remains green through `typesVersions`.
5. The five public error classes, `BAML_PORT_VERSION`, `BamlClientOptions`, `BamlFunctionSet`, and `BamlTurnResult` remain exported without source or runtime behavior changes.

## Locked Decisions

### D1. AF-7bv's transformer is the only declaration rewrite mechanism

AF-sy8 does not rewrite `src/llm/baml/**/*.ts` and does not add a BAML-only postprocessor. The prerequisite build step traverses the full emitted declaration tree atomically, resolving both extensionless relatives and `@/` aliases.

### D2. Keep the named BAML consumer in the NodeNext/Node16 matrix

The all-exports fixture proves all 14 subpaths resolve, but a namespace-only import does not prove the BAML contract's named values and types survive barrel traversal. The NodeNext and Node16 configs must compile `type-consumer.ts` in addition to the all-exports fixture. The existing node10 config continues to prove the `typesVersions` mirror.

### D3. B19 is the blocking closure

Direct `dist/` inspection is a structural check. Completion requires the real `npm pack` tarball, extracted into B19's differently named scratch package, compiled by the repository's actual TypeScript binary. No source alias or direct `dist/types` root may substitute for that boundary.

### D4. No public BAML surface change

This work changes only how emitted declarations reference one another and how the packed package is verified. It does not add, remove, rename, or widen BAML values, types, errors, registration behavior, or runtime export conditions.

## What We're NOT Doing

- No BAML runtime/provider implementation changes.
- No edits to the root BAML registration side effect.
- No BAML-only declaration transformer or second declaration-tree pass.
- No changes to `exports`, `typesVersions`, ESM, or CJS artifact paths.
- No edits to the nine already-clean `./langchain/*` source facades.
- No Langfuse graph, callback, provider, streaming, or trace-shaping changes.

## Workflow Closure

**Promise**: the packed `@librechat/agents/baml` entry exposes its complete named public contract to NodeNext and Node16 TypeScript consumers.

**Classification**: BLOCKING. The behavior crosses declaration-build, npm-package, and consumer-resolution boundaries.

- **SOURCE**: `src/llm/baml/index.ts` and its reachable `ChatBAML.ts`, `errors.ts`, `types.ts`, and `toolBinding.ts` declarations.
- **TRIGGER**: `npm run build`, the highest changed connector inherited from AF-7bv.
- **FORBIDDEN SPAN**: declaration emit/rewrite, tarball creation/extraction, `exports.types` resolution, and named barrel traversal. The test does not import source aliases or seed generated declarations.
- **OBSERVABLE**: zero exit status from the real NodeNext and Node16 `tsc` processes launched by B19 while compiling `type-consumer.ts` from the extracted tarball.
- **DRIVERS**: none; every edge is synchronous.
- **RED-AT-SEAM**: omit the shared postprocessor and both consumers fail on `dist/types/llm/baml/index.d.ts:1,3,4`; omit alias rewriting and the reachable BAML leaf declarations fail next.
- **POSITIVE CONTROL**: the existing bundler/node10 type checks and three runtime consumers remain green.

## Phase 1: Red — lock the BAML named-surface failure

### Behavior 1.1: the public BAML contract fails under NodeNext/Node16 before the shared fix

**Given** the current packed package  
**When** TypeScript compiles `test/package/consumers/type-consumer.ts` under NodeNext or Node16  
**Then** it exits non-zero because the BAML declaration barrel cannot expose the named public surface.

#### Red

Use the NodeNext and Node16 configs introduced by AF-7bv, with `type-consumer.ts` included in their `files` arrays. Run:

```bash
npm run build
npm run test:package
```

Expected before implementation: the existing runtime, bundler, and node10 consumers pass; NodeNext and Node16 fail on the BAML declaration graph.

#### Green

No BAML source change. Proceed only after AF-7bv's declaration rewrite exists.

#### Refactor

Keep `type-consumer.ts` shared across bundler, node10, NodeNext, and Node16 so its named contract has one source of truth.

## Phase 2: Green — apply the shared declaration rewrite to BAML

### Behavior 2.1: the emitted BAML declaration closure is publishable

**Given** TypeScript's emitted BAML declarations  
**When** AF-7bv's post-emit step rewrites the full declaration tree  
**Then** the BAML barrel uses explicit `.js` edges and every reachable private alias is a resolvable relative `.js` or `/index.js` specifier.

#### Red

The Phase 1 B19 consumers remain red without the post-emit step. A structural scan also finds `@/` and extensionless first-party specifiers in `dist/types/llm/baml/**/*.d.ts`.

#### Green

Run the shared build unchanged for BAML:

```bash
npm run build
```

Verify the BAML entry and reachable declarations contain no residual source alias or extensionless first-party edge.

#### Refactor

Do not special-case `llm/baml`. BAML passes because the shared transformer resolves real declaration targets throughout `dist/types`.

## Phase 3: Closure — prove the packed BAML contract

### Behavior 3.1: B19 compiles the named BAML surface under all four type modes

**Given** B19's extracted tarball  
**When** its bundler, node10, NodeNext, and Node16 configs compile the shared BAML type consumer  
**Then** `BAML_PORT_VERSION`, `BamlClientOptions`, `BamlFunctionSet`, `BamlTurnResult`, and all five public error classes resolve with no casts or private path mappings.

#### Red

NodeNext/Node16 fail before the rewrite, as recorded in Phase 1.

#### Green

```bash
npm run test:package
```

All three runtime consumers and all four type modes pass.

#### Refactor

Keep the B19 output labels explicit so a failure names the resolution mode. Preserve fail-closed behavior: any non-zero consumer increments the failure count and makes the package test exit non-zero.

## File Inventory

| File | Action | AF-sy8 contract |
| --- | --- | --- |
| `config/declaration-import-replacer.cjs` | Inherited from AF-7bv | Rewrites the BAML declaration closure through the shared mechanism |
| `tsconfig.build.json` | Inherited from AF-7bv | Registers the shared declaration-aware replacer |
| `package.json` | Inherited from AF-7bv | Runs the post-emit declaration rewrite |
| `test/package/consumers/type-consumer.ts` | Preserve | Single no-cast named BAML contract fixture |
| `test/package/consumers/tsconfig.nodenext.json` | Inherited/verify | Compiles the named BAML fixture through `exports.types` |
| `test/package/consumers/tsconfig.node16.json` | Inherited/verify | Compiles the named BAML fixture under Node16 rules |
| `test/package/consumers/tsconfig.node10.json` | Preserve | Continues proving the `typesVersions` mirror |
| `test/package/run.mjs` | Inherited/verify | Keeps NodeNext/Node16 in the real packed B19 matrix |
| `src/llm/baml/**` | No change expected | Public/runtime BAML behavior remains unchanged |

## Success Criteria

### Automated Verification

- [ ] NodeNext and Node16 Red observed against the current BAML named consumer.
- [ ] AF-7bv's transformer unit suite passes: `npm run test:declarations`.
- [ ] `npm run build` exits 0.
- [ ] `rg -n "(?:from|import\\() ['\"]@/" dist/types/llm/baml -g '*.d.ts'` returns no matches.
- [ ] BAML first-party relative declaration edges use `.js` or `/index.js`.
- [ ] `npm run test:package` passes three runtime consumers plus bundler, node10, NodeNext, and Node16 type consumers.
- [ ] The packed NodeNext/Node16 configs compile `type-consumer.ts`, not only the all-exports namespace fixture.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] Touched-file ESLint checks exit 0.
- [ ] `npm audit` reports zero vulnerabilities.

### Manual Verification

- [ ] `dist/types/llm/baml/index.d.ts` contains `./ChatBAML.js`, `./errors.js`, and `./types.js`.
- [ ] `ChatBAML.d.ts`, `errors.d.ts`, `types.d.ts`, and `toolBinding.d.ts` contain only publishable first-party specifiers.
- [ ] The public BAML value/type/error inventory is unchanged.
- [ ] Existing BAML ESM/CJS registration behavior remains unchanged.

## References

- AF-sy8 research: `thoughts/searchable/shared/research/2026-08-16-12-21-AF-sy8-nodenext-baml-declarations.md`
- AF-7bv plan: `thoughts/searchable/shared/plans/2026-08-16-AF-7bv-nodenext-declarations.md`
- AF-7bv research: `thoughts/searchable/shared/research/2026-08-16-12-24-AF-7bv-nodenext-declaration-emit.md`
- Independent export probe: `thoughts/searchable/shared/research/2026-08-16-16-21-nodenext-exports-probe.md`
- Beads: `AF-sy8` depends on `AF-7bv`
