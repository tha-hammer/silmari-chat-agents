---
date: 2026-08-16T12:38:36-04:00
reviewer: ChartreusePuma
independent_reviewer: baml_surface_research
reviewed_commit: ba1174b57c8cd1b31bd51851599001a5a1f69219
plan: thoughts/searchable/shared/plans/2026-08-16-AF-sy8-nodenext-baml-declarations.md
bead: AF-sy8
status: needs-major-revision
---

# Review: AF-sy8 NodeNext-compatible `./baml` declarations

## Decision

**Needs Major Revision.** The packed-package closure and one-transformer boundary are sound, but implementation is not yet safe to begin. The plan has an impossible Red/Green ordering, leaves the named-consumer edit ownerless, under-specifies the public BAML contract, and depends on a `tsc-alias` custom-replacer API assumption contradicted by the installed version.

## Blocking findings

### F1. The dependency and TDD order cannot both be followed

**Categories:** promise, workflow closure, TDD ordering, dependency boundary
**Evidence:** The plan says AF-sy8 begins only after AF-7bv lands its rewrite (`AF-sy8 plan:18,103`), but its Red phase requires AF-7bv's new NodeNext/Node16 configs while expecting the pre-rewrite build to fail (`AF-sy8 plan:92-99`). AF-7bv's plan assigns those configs only to the all-exports fixture (`AF-7bv plan:122-125,192-195`), while AF-sy8 marks them `Inherited/verify` (`AF-sy8 plan:167-170`). No plan owns adding `type-consumer.ts` to their `files` arrays.

**Required enhancement:** Treat the already-recorded pre-fix NodeNext and Node16 failures as AF-sy8's Red evidence. Make AF-sy8 a dependent acceptance subphase after AF-7bv. Explicitly assign AF-sy8 ownership of verifying and, if absent, adding both `all-exports-consumer.mts` and `type-consumer.ts` to `tsconfig.nodenext.json` and `tsconfig.node16.json`, with `skipLibCheck: false`. Preserve the Red transcript in the research document rather than attempting to recreate it after the dependency is green.

### F2. “Complete named public contract” is not what the fixture proves

**Categories:** contract, API, interface, test strength
**Evidence:** `src/llm/baml/index.ts:12-14` exports `ChatBAML`, five error values, `BAML_PORT_VERSION`, and every declaration from `types.ts`. The source has seven runtime values and eighteen exported type declarations (`src/llm/baml/types.ts:10-133`, `src/llm/baml/errors.ts:15-99`). The current fixture references only the version, three types, and five errors (`test/package/consumers/type-consumer.ts:7-39`). The plan repeats that partial inventory (`AF-sy8 plan:39,141`) while promising a complete named contract (`AF-sy8 plan:70`).

**Required enhancement:** Modify the single shared `type-consumer.ts` fixture to import/reference all seven runtime values and all eighteen type declarations without casts. Keep it compile-only and use minimal valid type-level/value-level witnesses. Update the desired state, closure promise, file inventory, and success criteria to name this complete inventory. At minimum, `ChatBAML` cannot remain untested.

### F3. The inherited transformer contract assumes the wrong installed API

**Categories:** interface, data transformation, dependency integration, hidden assumption
**Evidence:** AF-7bv describes a replacer that receives one specifier (`AF-7bv plan:53-64`). Installed `tsc-alias` defines the callback as `{ orig, file, config } -> string` (`node_modules/tsc-alias/dist/interfaces.d.ts:72-82`). `orig` is the full matched import/export/module expression and the result must also be the full expression (`node_modules/tsc-alias/dist/helpers/replacers.js:127-134`, `node_modules/tsc-alias/dist/utils/import-path-resolver.js:32-45,68-80`). The custom loader accepts only `replacerModule.default` (`node_modules/tsc-alias/dist/helpers/replacers.js:65-75`). A vague CommonJS export or specifier-only return can silently fail to load or corrupt declaration syntax.

**Required enhancement:** Before AF-sy8 accepts the inherited mechanism, require AF-7bv to specify and test `exports.default`, parse and replace only the quoted path inside the full statement, preserve all surrounding syntax and quote style, and emit exact file/specifier diagnostics on unresolved paths. Add a real `tsc-alias` integration test—not only direct helper tests—to prove the custom module loads and the default alias replacer runs before the declaration extension replacer.

## High-priority findings

### F4. The Beads dependency is prose-only

**Categories:** dependency boundary, durable workflow state
**Evidence:** The plan frontmatter and references say AF-sy8 depends on AF-7bv (`AF-sy8 plan:8,201`), but `bd dep list AF-sy8` reports no dependencies.

**Required enhancement:** Run `bd dep add AF-sy8 AF-7bv` and verify `bd dep list AF-sy8` records the blocker before implementation.

### F5. Planned lint verification cannot inspect the new files

**Categories:** cleanup, verification enforceability
**Evidence:** The AF-sy8 plan requires touched-file ESLint (`AF-sy8 plan:185`), and AF-7bv proposes `npx eslint src/ config/declaration-import-replacer.test.mjs` (`AF-7bv plan:170`). The repository globally ignores `config/**/*`, `**/*.js`, and `**/*.mjs` (`eslint.config.mjs:8-15`), and the `.cjs` implementation is absent from the command.

**Required enhancement:** Replace the unenforceable lint claim with checks that actually run for both artifacts: the real `node:test`/integration suite, `node --check` for `.cjs`/`.mjs`, and the repository formatter or an explicit syntax/style check that does not silently ignore them. Do not report ESLint coverage for ignored files.

## Medium-priority findings

### F6. The structural check does not define the transitive closure it promises

**Categories:** data, closure, observability
**Evidence:** The plan promises every declaration reachable from BAML (`AF-sy8 plan:36,74-79`) but its alias scan is limited to `dist/types/llm/baml` (`AF-sy8 plan:180`). BAML declarations reach modules outside that directory, including `dist/types/session` and `dist/types/types/llm` through `types.d.ts`.

**Required enhancement:** Keep the targeted BAML barrel assertions, but use the shared transformer's full-tree residual-specifier validation and packed `skipLibCheck: false` NodeNext/Node16 compile as the transitive proof. State that a directory-local `rg` is diagnostic only, not closure evidence.

### F7. The comment and file inventory incorrectly say the fixture is preserved

**Categories:** maintainability, documentation
**Evidence:** `type-consumer.ts:4-6` says it is checked only under bundler and node10. The plan marks that file `Preserve` (`AF-sy8 plan:166`) even though the enhanced contract must add NodeNext/Node16 and complete named-surface coverage.

**Required enhancement:** Mark `type-consumer.ts` as `Modify`; update the resolution-mode comment and expand its named contract. Keep one fixture shared by all four type modes.

### F8. “Atomically” overstates the inherited tool's write behavior

**Categories:** data transformation, failure semantics
**Evidence:** The plan says the prerequisite transforms the full tree atomically (`AF-sy8 plan:45`). Installed `tsc-alias` reads and writes each changed declaration separately (`node_modules/tsc-alias/dist/helpers/replacers.js:112-120`), so a later thrown error can leave an already-partially-rewritten ignored `dist/` tree.

**Required enhancement:** Remove “atomically.” Define the contract as one deterministic invocation that fails the build on unresolved specifiers. Do not promise filesystem transactionality unless AF-7bv explicitly stages the output and commits it only after full validation.

### F9. The planned alias regex is too syntax-specific

**Categories:** data, verification strength
**Evidence:** The success criterion matches only selected `from` and `import(` forms (`AF-sy8 plan:180`), while declaration syntax can also contain import-type expressions and differently spaced or quoted literals.

**Required enhancement:** Use a complete literal diagnostic such as `rg -n "['\"]@/" dist/types/llm/baml -g '*.d.ts'`, with the shared full-tree validator and strict packed compiles remaining authoritative.

### F10. Invalid custom-loader configuration is not inherently fatal

**Categories:** interface, failure semantics, dependency integration
**Evidence:** AF-7bv's independent review confirmed that the installed loader reports an invalid custom module through `config.output.error` without guaranteeing a non-zero command. A build can therefore appear successful while skipping the extension replacer unless a fatal postcondition exists.

**Required enhancement:** Specify the exact `enabled`/`file` configuration and require an integration test that invokes real `tsc-alias`. Make missing/invalid loader behavior non-zero directly or through a deterministic post-command full-tree validator that detects the skipped rewrite.

## Review matrix

| Area | Result | Notes |
| --- | --- | --- |
| Contracts | Revise | Promise says complete BAML surface; fixture proves only a subset |
| Interfaces | Blocked | Installed custom-replacer interface and nonfatal loader behavior differ from the plan's assumptions |
| Promises/closure | Revise | Packed B19 is correct; Red ordering and transitive scan are not |
| Data transformations | Blocked | Full-statement preservation, quote handling, integration ordering, and partial-write behavior are unspecified |
| API compatibility | Revise | No source/runtime change is correct, but the full existing export inventory needs witnesses |
| Test strength | Revise | Real tarball and no mocks are strong; add complete named fixture and real tsc-alias integration |
| Cleanup | Revise | Proposed ESLint command ignores the new files |

## Cleanup-rule audit

| Rule | Result | Review note |
| --- | --- | --- |
| No side effects in conditionals | Pass in plan | Fail-closed checks use guard clauses; integration test must confirm thrown diagnostics |
| No mutation in control expressions | Pass in plan | No planned control-expression mutation |
| Never nesting | Pass in plan | The shared helper design is flat and guard-clause oriented |
| Named constants over literals | Pass in plan | Supported extensions/suffixes are assigned constants in AF-7bv's refactor phase |
| Control-expression discipline | Pass in plan | No assignment-in-condition or ternary-control trick is planned |
| Maintainability recovery | Revise | Replace ownerless inherited/verify steps with explicit ownership and enforceable checks |
| Test doubles/mocking | Pass | Tests use real temp declarations, real tsc-alias, real npm pack, and real TypeScript |

## Approval conditions

The plan is ready for implementation only after all of the following are incorporated in place:

1. Make the recorded baseline failures the Red and sequence AF-sy8 after AF-7bv.
2. Give AF-sy8 explicit ownership of the named-consumer matrix check/edit.
3. Expand the fixture and acceptance inventory to all seven runtime values and eighteen types.
4. Add the durable `AF-sy8 -> AF-7bv` Beads dependency.
5. Require a real tsc-alias integration test for exact config, loader shape, full-statement preservation, replacer ordering, and fatal skipped-loader detection.
6. Replace ignored ESLint claims with enforceable checks.
7. Remove the false atomicity promise and strengthen the residual-alias scan.
8. Define packed, `skipLibCheck: false` compilation as the transitive closure proof.
