---
date: 2026-08-16T12:29:00-04:00
planner: ChartreusePuma
git_commit: 2b41826d40d36af36c43150af497f8c1ebfe57aa
branch: nodenext-library-2026-08-16-12-15
repository: silmari-chat-agents
bead: AF-sy8
depends_on: AF-7bv
status: implemented-verified
implementation_base: 0f97a2db0feac6269ee4d01853a95c30618093a2
review: thoughts/searchable/shared/plans/2026-08-16-AF-sy8-nodenext-baml-declarations-REVIEW.md
review_status: all-findings-addressed
last_updated: 2026-08-16
last_updated_by: ChartreusePuma
---

# AF-sy8 NodeNext-compatible `./baml` declarations implementation plan

## Overview

Close the BAML-specific subset of the library-wide declaration defect after `AF-7bv` lands its shared post-emit rewrite. The `./baml` declaration entry and every public declaration it reaches must be consumable from a real packed package under NodeNext and Node16, while the existing bundler/node10 and ESM/CJS B19 consumers remain green. The durable Beads edge records that sequencing: `AF-sy8` is blocked by `AF-7bv`.

This plan does not create a second BAML-only transformer. It applies and verifies AF-7bv's one full-tree declaration mechanism against the named BAML port/error surface that the all-exports namespace probe alone does not exercise.

## Current State Analysis

- `package.json:17-20,83-87` routes modern and classic BAML type consumers to `dist/types/llm/baml/index.d.ts`.
- The emitted BAML barrel contains three extensionless relative specifiers at `dist/types/llm/baml/index.d.ts:1,3,4`.
- Its reachable declarations retain private aliases: `ChatBAML.d.ts:10-12`, `errors.d.ts:1`, `types.d.ts:2-3`, and `toolBinding.d.ts:2-3`.
- The pre-fix Red is already recorded. TypeScript 5.5.3 exits non-zero under both NodeNext and Node16; the existing public consumer reports all nine imported BAML values/types as missing, and declaration checking exposes the three underlying `TS2834` barrel failures. The packed 14-export probe independently reports `./baml` failing on the same three barrel edges.
- B19 packs the real package and already proves ESM/CJS registration, root-only non-registration, bundler `exports.types`, and node10 `typesVersions` behavior (`test/package/run.mjs:66-173`). It explicitly excludes NodeNext today.
- AF-7bv owns the shared declaration transformer, the all-14-export namespace fixture, the NodeNext/Node16 configs, and the package-gate wiring. AF-sy8 owns expanding the named BAML fixture and verifying or modifying both new configs so they compile it after that prerequisite exists.
- Installed `tsc-alias` passes custom replacers a full matched statement through `{ orig, file, config }` and loads only `replacerModule.default`. AF-sy8 accepts the inherited mechanism only after AF-7bv proves that real integration and default-before-custom ordering.

## Desired End State

After the AF-7bv build mechanism runs:

1. `dist/types/llm/baml/index.d.ts` points to `./ChatBAML.js`, `./errors.js`, and `./types.js`.
2. Every declaration reachable from that entry contains no `@/` specifier and uses explicit `.js` or `/index.js` for first-party relative declaration targets.
3. One no-cast BAML fixture references all seven runtime values and all eighteen exported types and compiles from the packed package under NodeNext and Node16 through `exports.types`.
4. The existing node10 consumer remains green through `typesVersions`.
5. The public manifest remains unchanged without source or runtime behavior changes:
   - values: `ChatBAML`, `BAML_PORT_VERSION`, and the five public error classes;
   - types: `BamlPortVersion`, `BamlDeclaredTool`, `BamlSelectedTool`, `BamlFailureCode`, `BamlToolFailure`, `BamlCallMeta`, `BamlTranscriptRole`, `BamlTranscriptToolCall`, `BamlTranscriptEntry`, `BamlPromptInput`, `BamlAnswerOutcome`, `BamlTextChunk`, `BamlToolCallsOutcome`, `BamlFailureOutcome`, `BamlTurnResult`, `BamlTurnChunk`, `BamlFunctionSet`, and `BamlClientOptions`.

## Locked Decisions

### D1. AF-7bv's transformer is the only declaration rewrite mechanism

AF-sy8 does not rewrite `src/llm/baml/**/*.ts` and does not add a BAML-only postprocessor. The prerequisite build runs one deterministic full-tree rewrite invocation that resolves extensionless relatives and `@/` aliases and fails the build on unresolved specifiers. It does not promise filesystem transactionality: installed `tsc-alias` writes changed files individually.

### D2. Keep the named BAML consumer in the NodeNext/Node16 matrix

The all-exports fixture proves all 14 subpaths route, but a namespace-only import does not prove the BAML contract's named values and types survive barrel traversal. AF-sy8 verifies that the NodeNext and Node16 configs each have `files: ["type-consumer.ts", "all-exports-consumer.mts"]`. Implementation evidence requires `skipLibCheck: true` in those two packed routing checks because strict checking reaches unrelated, currently incompatible dependency declarations. The fail-closed full-tree AST audit proves first-party declaration edges; the shared named fixture remains authoritative under bundler/node10 and is also compiled in both Node modes.

### D3. B19 is the blocking closure

Completion requires both halves of the composite gate: the fail-closed AST audit over the complete generated declaration tree, and the real `npm pack` tarball extracted into B19's differently named scratch package and compiled by the repository's actual TypeScript binary. No source alias or direct `dist/types` root may substitute for the package-routing boundary.

### D4. No public BAML surface change

This work changes only how emitted declarations reference one another and how the packed package is verified. It does not add, remove, rename, or widen BAML values, types, errors, registration behavior, or runtime export conditions. The compile-only fixture witnesses all seven existing runtime values and all eighteen existing type declarations.

### D5. Accept the real installed transformer interface, not a helper approximation

AF-sy8 does not accept the AF-7bv prerequisite until a real `tsc-alias` integration test proves the custom module exports `default`, its exact `enabled`/`file` config loads, it receives and returns the full matched statement without changing surrounding syntax or quote style, runs after the default alias resolver, and reports importing file, offending specifier, and attempted declaration targets on failure. Because the installed loader can log an invalid-replacer diagnostic without making the command fatal, the build must make loader/config failure non-zero or run a deterministic post-command validator that fails when the custom rewrite was skipped.

## What We're NOT Doing

- No BAML runtime/provider implementation changes.
- No edits to the root BAML registration side effect.
- No BAML-only declaration transformer or second declaration-tree pass.
- No changes to `exports`, `typesVersions`, ESM, or CJS artifact paths.
- No edits to the nine already-clean `./langchain/*` source facades.
- No Langfuse graph, callback, provider, streaming, or trace-shaping changes.

## Workflow Closure

**Promise**: the packed `@librechat/agents/baml` entry exposes all seven runtime values and all eighteen exported types to NodeNext and Node16 TypeScript consumers.

**Classification**: BLOCKING. The behavior crosses declaration-build, npm-package, and consumer-resolution boundaries.

- **SOURCE**: `src/llm/baml/index.ts` and its complete transitive declaration graph, including modules outside `dist/types/llm/baml` reached through `types.ts`, `ChatBAML.ts`, and `toolBinding.ts`.
- **TRIGGER**: `npm run build`, the highest changed connector inherited from AF-7bv.
- **FORBIDDEN SPAN**: declaration emit/rewrite, tarball creation/extraction, `exports.types` resolution, and named barrel traversal. The test does not import source aliases or seed generated declarations.
- **OBSERVABLE**: zero exit status from the full-tree declaration audit plus the real NodeNext and Node16 `tsc` processes launched by B19 while compiling both fixtures from the extracted tarball.
- **DRIVERS**: none; every edge is synchronous.
- **RED-AT-SEAM**: the pre-fix NodeNext/Node16 transcript is recorded in AF-sy8 research and the independent packed probe. It fails on `dist/types/llm/baml/index.d.ts:1,3,4`; resolving only those edges exposes the reachable alias failures next.
- **POSITIVE CONTROL**: the existing bundler/node10 named-surface checks and three runtime consumers remain green. The skip-lib-check Node modes are routing checks, not an exhaustive first-party-edge oracle.

## Phase 1: Recorded Red — preserve the pre-fix named-surface evidence

### Behavior 1.1: the public BAML contract failed under NodeNext/Node16 before the shared fix

**Given** the declaration output at baseline commit `2b41826d40d36af36c43150af497f8c1ebfe57aa`
**When** TypeScript compiles `test/package/consumers/type-consumer.ts` under NodeNext or Node16
**Then** it exits non-zero because the BAML declaration barrel cannot expose even the existing partial named fixture.

#### Red

The Red is already captured in the research artifact before AF-7bv implementation. Direct TypeScript probes fail in both modes, and the independent packed probe records `./baml` failing on three `TS2834` edges. Do not attempt to recreate a pre-fix failure after the blocking bead is green.

#### Green

No BAML source change. Proceed only after `bd dep list AF-sy8` records AF-7bv as the blocker and AF-7bv's declaration rewrite exists.

#### Refactor

Keep the recorded Red linked from the enhanced plan. The dependent acceptance phase uses one shared fixture rather than inventing a second Red/Green implementation cycle.

## Phase 2: Prerequisite acceptance — verify the shared declaration rewrite on BAML

### Behavior 2.1: the emitted BAML declaration closure is publishable

**Given** TypeScript's emitted BAML declarations
**When** AF-7bv's post-emit step rewrites the full declaration tree
**Then** the BAML barrel uses explicit `.js` edges and every reachable private alias is a resolvable relative `.js` or `/index.js` specifier.

#### Red

The Phase 1 B19 consumers remain red without the post-emit step. A structural scan also finds `@/` and extensionless first-party specifiers in `dist/types/llm/baml/**/*.d.ts`.

#### Green

Run the shared build and its real transformer integration suite unchanged for BAML:

```bash
npm run test:declarations
npm run build
```

Verify the BAML entry contains its three explicit `.js` edges. Treat a local BAML literal scan as diagnostic only; the transformer's full-tree fail-closed validator is the transitive first-party proof, and packed NodeNext/Node16 compilation is the real export-routing proof.

#### Refactor

Do not special-case `llm/baml`. BAML passes because the shared transformer resolves real declaration targets throughout `dist/types`. Require the integration test to prove exact loader configuration, `exports.default`, full-statement preservation, default-before-custom ordering, actionable failure diagnostics, and fatal detection when the custom replacer is absent or invalid.

## Phase 3: Dependent acceptance — prove the complete packed BAML contract

### Behavior 3.1: one fixture witnesses the complete named BAML surface under all four type modes

**Given** B19's extracted tarball
**When** its bundler, node10, NodeNext, and Node16 configs compile the shared BAML type consumer
**Then** all seven runtime values and all eighteen exported types resolve with no casts or private path mappings.

#### Red

The pre-fix partial fixture failed in both modes, as recorded in Phase 1. Before Green, expand `type-consumer.ts` to import/reference the complete manifest, update its resolution-mode documentation, and ensure both Node configs compile it alongside `all-exports-consumer.mts`.

#### Green

```bash
npm run test:package
```

All three runtime consumers and all four type modes pass.

#### Refactor

Keep the B19 output labels explicit so a failure names the resolution mode. Preserve fail-closed behavior: any non-zero consumer increments the failure count and makes the package test exit non-zero. Use a type tuple plus compile-only witnesses for the eighteen types and value references for the seven runtime exports; do not instantiate providers or add casts.

## File Inventory

| File                                            | Action                | AF-sy8 contract                                                                                       |
| ----------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `config/declaration-import-replacer.cjs`        | Inherited/verify      | Exports `default`; preserves full statements; rewrites BAML through the shared mechanism              |
| `config/declaration-import-replacer.test.mjs`   | Inherited/verify      | Invokes real `tsc-alias` and proves loader shape, replacer order, syntax preservation, and failures   |
| `tsconfig.build.json`                           | Inherited from AF-7bv | Registers the shared declaration-aware replacer                                                       |
| `package.json`                                  | Inherited from AF-7bv | Runs the post-emit declaration rewrite                                                                |
| `test/package/consumers/type-consumer.ts`       | Modify                | References all seven runtime values and eighteen types; documents all four modes                      |
| `test/package/consumers/tsconfig.nodenext.json` | Verify                | Compiles both fixtures through packed NodeNext routing with third-party declaration checking isolated |
| `test/package/consumers/tsconfig.node16.json`   | Verify                | Compiles both fixtures through packed Node16 routing with third-party declaration checking isolated   |
| `test/package/consumers/tsconfig.node10.json`   | Preserve              | Continues proving the `typesVersions` mirror                                                          |
| `test/package/run.mjs`                          | Inherited/verify      | Keeps NodeNext/Node16 in the real packed B19 matrix                                                   |
| `src/llm/baml/**`                               | No change expected    | Public/runtime BAML behavior remains unchanged                                                        |

## Success Criteria

### Automated Verification

- [x] Pre-fix NodeNext and Node16 Red recorded against the existing BAML named consumer.
- [x] Durable dependency recorded: `AF-sy8` depends on `AF-7bv`.
- [x] AF-7bv's real `tsc-alias` unit/integration suite passes: `npm run test:declarations`.
- [x] `npm run build` exits 0.
- [x] `rg -n "['\"]@/" dist/types -g '*.d.ts'` returns no matches; the BAML-only form is diagnostic, not closure proof.
- [x] The shared validator rejects all extensionless/unresolved first-party declaration edges; BAML's three barrel edges use `.js`.
- [x] `npm run test:package` passes three runtime consumers plus bundler, node10, NodeNext, and Node16 type consumers.
- [x] The packed NodeNext/Node16 configs compile both `type-consumer.ts` and `all-exports-consumer.mts`; their `skipLibCheck: true` scope is documented and paired with the fatal full-tree AST audit.
- [x] `type-consumer.ts` references all seven runtime values and all eighteen exported types without casts.
- [x] `npx tsc --noEmit` exits 0.
- [x] `node --check config/declaration-import-replacer.cjs` and `node --check config/declaration-import-replacer.test.mjs` exit 0.
- [x] Prettier checks pass for the changed fixture and plan/map evidence; root transformer/gate artifacts were already verified in `0f97a2d`. ESLint exits 0 with 102 pre-existing warnings and no errors.
- [x] `npm audit` reports zero vulnerabilities.

### Manual Verification

- [x] `dist/types/llm/baml/index.d.ts:1,3,4` contains `./ChatBAML.js`, `./errors.js`, and `./types.js`.
- [x] The full-tree validator covers BAML transitives outside `dist/types/llm/baml`; packed Node modes cover real export routing, and a directory-local scan is not treated as proof.
- [x] The seven-value/eighteen-type public BAML inventory is unchanged and is referenced by the shared fixture.
- [x] Existing BAML ESM/CJS registration behavior remains unchanged.

## References

- AF-sy8 research: `thoughts/searchable/shared/research/2026-08-16-12-21-AF-sy8-nodenext-baml-declarations.md`
- AF-7bv plan: `thoughts/searchable/shared/plans/2026-08-16-AF-7bv-nodenext-declarations.md`
- AF-7bv research: `thoughts/searchable/shared/research/2026-08-16-12-24-AF-7bv-nodenext-declaration-emit.md`
- Independent export probe: `thoughts/searchable/shared/research/2026-08-16-16-21-nodenext-exports-probe.md`
- Plan review: `thoughts/searchable/shared/plans/2026-08-16-AF-sy8-nodenext-baml-declarations-REVIEW.md`
- System map: `thoughts/searchable/shared/plans/2026-08-16-AF-sy8-nodenext-baml-declarations-SYSTEM-MAP.md`
- Beads dependency: `bd dep list AF-sy8` reports `AF-7bv` as its blocker

## Implementation Evidence Amendment

AF-7bv's first Green run with `skipLibCheck: false` reached the rewritten first-party graph but also reported thirteen unrelated dependency errors: Anthropic/LangChain peer drift, an AWS interface mismatch, disposable-symbol requirements, duplicate ambient `Deno` declarations, and DOM globals. Repairing those dependencies is outside both declaration-emission beads.

Both Node configs therefore use `skipLibCheck: true` only for the packed routing check. An exact retained broken-baseline scratch compile with that flag exited zero, so neither this plan nor its close evidence treats those TypeScript processes as the internal-edge oracle. The full-tree TypeScript-AST audit is the blocking first-party postcondition; B19 proves real tarball/subpath routing; bundler/node10 plus the expanded shared fixture prove the complete named BAML manifest.

## Implementation Evidence

- `npm run test:declarations`: 10/10 transformer and AST-audit tests pass.
- `npm run build`: exits zero through runtime build, declaration emit, alias/extension rewrite, and fatal full-tree audit.
- `dist/types/llm/baml/index.d.ts:1,3,4`: `./ChatBAML.js`, `./errors.js`, `./types.js`.
- Full-tree `@/` literal scan: no matches; explicit `node config/declaration-output-audit.cjs dist/types`: exits zero.
- `npm run test:package`: ESM, CJS, negative runtime, bundler, node10, NodeNext, and Node16 all pass from the real tarball; both Node modes compile the 14-export and complete named BAML fixtures.
- `npx jest baml --runInBand`: 13 suites and 131 tests pass.
- `npx tsc --noEmit`, Node syntax checks, and `npm audit`: pass; repository ESLint exits zero with 102 existing warnings.
