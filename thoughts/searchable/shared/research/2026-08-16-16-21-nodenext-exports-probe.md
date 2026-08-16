---
date: 2026-08-16T12:21:20-04:00
researcher: SapphireAnchor (claude-code, AF-7bv/AF-sy8 swarm)
git_commit: 2b41826d40d36af36c43150af497f8c1ebfe57aa
branch: nodenext-library-2026-08-16-12-15
repository: silmari-chat-agents (npm package `@librechat/agents` v3.4.3)
topic: 'Real moduleResolution:nodenext probe of all 14 package.json exports subpaths'
tags: [research, nodenext, node16, exports, types, af-7bv, af-sy8, packaging]
status: complete
last_updated: 2026-08-16
last_updated_by: SapphireAnchor
---

# Research: NodeNext resolution probe across all 14 `exports` subpaths

**Date**: 2026-08-16T12:21:20-04:00
**Researcher**: SapphireAnchor (claude-code)
**Git Commit**: [`2b41826`](https://github.com/tha-hammer/silmari-chat-agents/blob/2b41826d40d36af36c43150af497f8c1ebfe57aa)
**Branch**: `nodenext-library-2026-08-16-12-15`

## Purpose

AF-7bv/AF-sy8 assert 5 of 14 `exports` subpaths fail NodeNext type resolution and 9 (the `./langchain/*` leaves) already pass. This doc is an independently-run, real `moduleResolution:nodenext` probe against a **packed tarball** (not source aliases) confirming that claim with per-file error-code evidence, plus one non-obvious scope finding for whoever writes the AF-7bv plan.

## Method

1. `npm run build` (tsdown + `tsc -p tsconfig.build.json`) to populate `dist/`.
2. `npm pack --ignore-scripts` the real tarball, extracted into a scratch `node_modules/@librechat/agents` (mirrors `test/package/run.mjs`'s existing B19 pack/extract pattern).
3. Symlinked `@langchain/*` peer packages from the repo's own `node_modules` into the scratch tree (required — module resolution needs these on disk to avoid false-positive "cannot find module" noise unrelated to the defect).
4. One `tsconfig.json` (`module`/`moduleResolution: nodenext`, `strict: true`) with 14 `.mts` probe files, one per `exports` subpath, each doing only `import type * as m from '@librechat/agents/<subpath>'; export type X = typeof m;` — i.e. exercising real package resolution through `exports`/`typesVersions`, nothing else.
5. `tsc -p tsconfig.json`, `noEmit`.

Scratch dir: `/tmp/.../scratchpad/nodenext-probe/` (not part of the repo; reproducible from the steps above).

## Results — confirms AF-7bv/AF-sy8's claim exactly

**5 of 14 subpaths fail; 9 of 14 (`./langchain/*` leaves) are clean (0 errors).**

| `exports` subpath | dist file | Errors | Root cause |
|---|---|---|---|
| `.` (root) | `dist/types/index.d.ts` | 46× `TS2834` | Extensionless relative barrel re-exports (`export * from './run'`, etc.) |
| `./langchain` | `dist/types/langchain/index.d.ts` | 8× `TS2834` | Same — extensionless barrel re-exports |
| `./baml` | `dist/types/llm/baml/index.d.ts` | 3× `TS2834` | Extensionless `./ChatBAML`, `./errors`, `./types` |
| `./openai` | `dist/types/openai/index.d.ts` | 1× `TS2307` | Unrewritten `@/types` alias |
| `./responses` | `dist/types/responses/index.d.ts` | 1× `TS2307` | Unrewritten `@/types` alias |
| `./langchain/language_models/chat_models` | — | 0 | clean |
| `./langchain/messages` | — | 0 | clean |
| `./langchain/messages/tool` | — | 0 | clean |
| `./langchain/google-common` | — | 0 | clean |
| `./langchain/openai` | — | 0 | clean |
| `./langchain/prompts` | — | 0 | clean |
| `./langchain/runnables` | — | 0 | clean |
| `./langchain/tools` | — | 0 | clean |
| `./langchain/utils/env` | — | 0 | clean |

`TS2834` = "Relative import paths need explicit file extensions in ECMAScript imports when `--moduleResolution` is `node16` or `nodenext`." `TS2307` = "Cannot find module" (here, the literal specifier `@/types`, which nodenext has no alias config to resolve).

None of the 14 probe entry points themselves failed to resolve (no `Cannot find module '@librechat/agents/...'` errors) — `exports`/`typesVersions` wiring itself is fine; every failure originates *inside* the resolved `.d.ts` file.

## Scope finding for the plan: current failures are a floor, not the full picture

TypeScript short-circuits per-file at the **first** unresolvable specifier — it does not keep resolving deeper into a file's other imports once one import fails to resolve as a module. That means:

- `dist/types/openai/index.d.ts` and `dist/types/responses/index.d.ts` each show exactly **one** error (the `@/types` alias on line 1) because that failure prevents tsc from reaching whatever comes after in the same file. Once that alias is rewritten, more errors may surface from later imports in those same files.
- More importantly: **113 files under `dist/types/` carry unrewritten `@/` aliases** (counted via `grep -rl "from '@/" dist/types/`), e.g. `dist/types/llm/baml/errors.d.ts` and `dist/types/llm/baml/types.d.ts` both import `@/llm/baml/types` / similar. These are reached via the barrel's `export * from './errors'` / `'./types'` lines, which currently fail on the *missing extension* (`TS2834`) before tsc ever loads `errors.d.ts`/`types.d.ts` far enough to hit their own `@/` imports.
- **Practical implication**: fixing the barrel-extension problem alone (adding `.js` to relative re-exports) will *unmask* a new wave of `@/`-alias errors in the leaf files it re-exports — for `./baml` specifically, `errors.d.ts` and `types.d.ts` are already known instances (per AF-7bv's own description). The plan should treat "add extensions" and "rewrite `@/` aliases" as one atomic pass over `dist/types/**/*.d.ts`, verified in that order (extensions first would still fail-then-reveal aliases; a single rewrite step doing both in one `dist/types` pass, then one clean nodenext compile, avoids a two-round surprise).
- The 9 currently-clean `./langchain/*` leaves show 0 errors *today*, but that's under the current (broken) barrel graph — none of them import the root `index.d.ts` or `langchain/index.d.ts` barrels, so they aren't at risk of newly-unmasked errors from the barrel fix. Confirmed clean independent of the fix.

## Reproduction

```bash
npm run build
npm pack --ignore-scripts --pack-destination /tmp/probe && \
  mkdir -p /tmp/probe/node_modules/@librechat/agents && \
  tar -xzf /tmp/probe/librechat-agents-*.tgz -C /tmp/probe/node_modules/@librechat/agents --strip-components=1
# symlink node_modules/@langchain/* from the repo into /tmp/probe/node_modules/@langchain/
# add a nodenext tsconfig.json + one probe .mts per subpath (see Method above)
tsc -p /tmp/probe/tsconfig.json
```

## Relevant files

- `package.json` — the 14-entry `exports` map probed here.
- `dist/types/index.d.ts`, `dist/types/langchain/index.d.ts`, `dist/types/llm/baml/index.d.ts`, `dist/types/openai/index.d.ts`, `dist/types/responses/index.d.ts` — the 5 failing entry files.
- `test/package/run.mjs:154-160` — existing comment documenting nodenext as deliberately not gated; restore once emit is fixed (tracked as my follow-up slice, held until GentleRiver's AF-7bv plan is implemented).
- `tsconfig.build.json` — current type-emit config (`moduleResolution: "bundler"`), source of the un-rewritten output.
