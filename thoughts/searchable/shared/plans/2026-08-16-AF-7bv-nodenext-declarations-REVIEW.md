---
date: 2026-08-16T12:39:34-04:00
reviewer: IvoryBay
git_commit: ba1174b57c8cd1b31bd51851599001a5a1f69219
branch: nodenext-library-2026-08-16-12-15
repository: silmari-chat-agents
plan: thoughts/searchable/shared/plans/2026-08-16-AF-7bv-nodenext-declarations.md
plan_git_commit: 2b41826d40d36af36c43150af497f8c1ebfe57aa
plan_sha256: 6982ddbee995d6241f72986d31819b8e22d73b377eb9f044596c373a2f2cf002
beads: [AF-7bv, AF-sy8]
status: complete
verdict: needs-major-revision
last_updated: 2026-08-16
last_updated_by: IvoryBay
---

# Plan Review: AF-7bv NodeNext-compatible declarations

## Verdict

**Needs Major Revision.** The architecture and published-package closure are sound, but two blocking contracts are missing or inaccurate: the NodeNext/Node16 matrix does not explicitly compile AF-sy8's existing named BAML consumer, and the custom-replacer plan does not match the installed `tsc-alias@1.8.10` loader/API contract. Resolve both before implementation.

## Review Summary

| Category | Status | Findings |
|---|---:|---:|
| Contracts | ❌ | 2 critical |
| Interfaces/APIs | ❌ | 1 critical, shared with Contracts |
| Promises/closure | ⚠️ | 2 warnings |
| Data models | ➖ | Not applicable; no persisted schema changes |
| Runtime/public API | ✅ | Runtime exports and BAML surface are preserved |
| CodeCleanup gates | ✅ | No blocking hygiene finding |
| Citation accuracy | ✅ | All cited repository paths and lines verified |

## Severity-ranked Findings

### Critical 1 — NodeNext and Node16 do not explicitly compile AF-sy8's named BAML contract

The plan adds an all-exports namespace fixture and two configs, but it only states that the new fixture imports all 14 subpaths and that Node16 extends the same strict contract (`plan:68-72,116-125`). It never requires either new config's `files` array to contain the existing `type-consumer.ts`.

That existing fixture is not redundant. It imports `BamlClientOptions`, `BamlFunctionSet`, and `BamlTurnResult`, references all five public error classes, and constructs the no-cast host adapter (`test/package/consumers/type-consumer.ts:7-39`). The current bundler and node10 configs make that fixture their sole file (`test/package/consumers/tsconfig.bundler.json:14`, `test/package/consumers/tsconfig.node10.json:14`). A namespace-only all-exports import proves declaration reachability, but not that AF-sy8's named value/type surface survives barrel traversal.

This is an explicit cross-plan acceptance contract: the AF-sy8 plan requires both Node modes to compile `type-consumer.ts` in addition to the all-exports fixture (`thoughts/searchable/shared/plans/2026-08-16-AF-sy8-nodenext-baml-declarations.md:46-48,70-72,120-129,187-188`). Without that requirement AF-7bv can report green while AF-sy8 remains unproven.

**Required amendment**:

- Specify that both `tsconfig.nodenext.json` and `tsconfig.node16.json` use `files: ["type-consumer.ts", "all-exports-consumer.mts"]` with `skipLibCheck: false`.
- Make both B19 labels state that they compile the all-exports matrix **and** the named BAML contract.
- Add an automated success criterion naming both files under both resolution modes.

### Critical 2 — The custom-replacer interface, export shape, and loader-order test are not implementation-ready

The plan says the replacer “receives one import/export/module specifier at a time” and models its input as a string (`plan:51-66`). The installed API instead defines an `AliasReplacer` as:

```ts
({ orig, file, config }: AliasReplacerArguments) => string
```

where `orig` is the complete matched import/export/module statement, not the bare specifier (`node_modules/tsc-alias/dist/interfaces.d.ts:72-82`, `node_modules/tsc-alias/dist/utils/import-path-resolver.js:7-23,32-34`). `tsc-alias` applies each replacer by passing that object and expects the complete statement back (`node_modules/tsc-alias/dist/helpers/replacers.js:127-134`). A replacer implemented against the plan's stated string contract receives an object and cannot perform the proposed grammar.

The `.cjs` export contract is also unspecified. The loader does `require(targetPath)` and reads only `replacerModule.default`; a plain `module.exports = replacer` is rejected as “not in replacer format” (`node_modules/tsc-alias/dist/helpers/replacers.js:65-75`). Worse, `Output.error()` is non-fatal unless explicitly passed `true`, so an invalid or missing custom replacer can be logged and omitted while `tsc-alias` continues (`node_modules/tsc-alias/dist/helpers/replacers.js:74,97`; `node_modules/tsc-alias/dist/utils/output.js:31-40`). This contradicts the plan's fail-closed build promise.

The desired order is feasible in 1.8.10: the loader creates `default`/`base-url` entries, spreads custom entries afterward, pushes them in `Object.entries` order, and executes the resulting array sequentially (`node_modules/tsc-alias/dist/helpers/replacers.js:33-41,50-70,127-134`). A read-only API probe also confirmed the default replacer transforms `@/types` to a relative declaration path. However, the proposed direct custom-replacer unit cases (`plan:68-72,99-114`) do not prove the real loader, `.default` export, configured file path, or default-before-custom ordering.

**Required amendment**:

- Lock the actual signature: `function declarationImportReplacer({ orig, file, config })`, extract the quoted module path from `orig`, and return the entire rewritten `orig` statement.
- Lock the CommonJS shape required by 1.8.10, such as `module.exports.default = declarationImportReplacer`.
- Show the exact `tsc-alias.replacers` object, including `enabled: true` and `file: "./config/declaration-import-replacer.cjs"`. Note that a generic custom key's relative file is resolved from `process.cwd()`, not the tsconfig directory (`helpers/replacers.js:30,77-79`); the npm build's repository-root CWD is therefore part of the contract.
- Add at least one integration test through the installed `tsc-alias` loader/API, not only a direct helper import. It must start with an `@/` statement and assert the final relative `.js` form, proving loader compatibility and default-before-custom order.
- Make missing/invalid custom loading fail the build explicitly. The stock loader's diagnostic alone is not fail-closed.

### Warning 1 — “Build twice” has no deterministic comparison

Behavior 3.1 promises two builds and stable declaration output (`plan:158-163`), but the automated command block runs one build and performs no hash or diff (`plan:164-174`). Because `dist/` is ignored, `git status` cannot establish output equality.

Add an executable comparison, such as a sorted checksum manifest of `dist/types` captured after each clean build and diffed before the package gate.

### Warning 2 — The automated lint and full-tree assertions do not cover the stated file/output scope

The lint command names only `src/` and the `.test.mjs`, omitting the new production `.cjs` replacer (`plan:166-171`), while the success criterion says touched JS/MJS is clean (`plan:209`). Include both added config files.

The desired state applies to every `dist/types/**/*.d.ts` (`plan:30-37`), but automated coverage is limited to transformer examples and the 14 public entrypoints; the only output inspection is manual and representative (`plan:178-182,212-216`). Add a post-build automated tree assertion that no module specifier retains `@/` and every first-party relative specifier has an allowed explicit extension. This independently catches syntax forms missed by the replacer's parser and declarations not reached by the public fixture.

## Verified Design Decisions

- The build/declaration split is cited correctly: `package.json:129`, `tsdown.config.mjs:9-20`, `tsconfig.json:13-16`, and `tsconfig.build.json:2-9` match the plan.
- The current B19 exclusion is correctly cited at `test/package/run.mjs:154-160`; its type matrix currently contains only bundler and node10 at lines 161-173.
- The current generated counts reproduce exactly: 113 `.d.ts` files contain `@/` module specifiers and 63 contain relative module specifiers.
- The stock full-path limitation is accurate. It probes for `<specifier>.js` and `<specifier>/index.js` beside the output file and otherwise returns the original path (`node_modules/tsc-alias/dist/utils/import-path-resolver.js:48-66`); a declaration-only tree supplies `.d.ts` siblings instead.
- Post-processing declarations rather than changing the source barrels keeps the runtime module graph out of scope and addresses the full-tree root cause.
- B19's pack/extract/real-`tsc` observation remains the correct blocking closure (`test/package/run.mjs:87-129,165-177`).

## CodeCleanup Plan-Hygiene Review

- **No side effects or mutation in control expressions**: well-defined. D3 explicitly requires pure predicates and guard clauses (`plan:66`). Preserve this when implementing filesystem probes.
- **Never nesting**: well-defined. The planned fail-fast grammar maps cleanly to ordered guards; preserve error precedence between residual aliases, explicit paths, file targets, directory targets, and missing targets.
- **Named constants**: well-defined. Phase 3 requires named supported extensions and declaration suffixes (`plan:160-163`). Those are structural values and should remain code constants, not external configuration.
- **Control-expression discipline**: well-defined once the real `{ orig, file, config }` boundary is made explicit.
- **Maintainability recovery**: well-defined. One shared declaration transformer addresses the build foundation instead of spreading 141 source edits or adding a BAML-only patch.

No CodeCleanup “When NOT to Apply” exception requires preserving hidden mutation, side-effect order, external numeric values, or nesting in this change.

## Required Plan Amendments

```diff
 Phase 1 / Node consumer configs
+ Both NodeNext and Node16 compile files:
+   ["type-consumer.ts", "all-exports-consumer.mts"]
+ Keep skipLibCheck: false and name both contracts in B19 output.

 Phase 1 / replacer contract tests
- Exercise only the custom replacer grammar directly.
+ Keep focused grammar tests, plus a real tsc-alias loader integration case
+ proving .default export loading and default-alias -> custom-extension order.

 Phase 2 / replacer interface
- The replacer receives a specifier string.
+ AliasReplacer receives { orig, file, config }; orig is the whole statement.
+ Export the .cjs function on module.exports.default.
+ Specify enabled/file config and repository-root CWD behavior.
+ Add an explicit fatal check for missing/invalid custom-replacer loading.

 Phase 3 / gates
+ Diff deterministic declaration manifests across two builds.
+ Lint config/declaration-import-replacer.cjs and its test.
+ Automatically audit the complete dist/types declaration tree.
```

## Approval Status

- [ ] Ready for Implementation
- [ ] Needs Minor Revision
- [x] **Needs Major Revision — critical contracts must be corrected before implementation**

