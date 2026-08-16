---
date: 2026-08-16T12:24:27-04:00
researcher: GentleRiver
git_commit: 2b41826d40d36af36c43150af497f8c1ebfe57aa
branch: nodenext-library-2026-08-16-12-15
repository: silmari-chat-agents
topic: 'AF-7bv current declaration emit and packed NodeNext consumption path'
tags: [research, codebase, typescript, nodenext, declarations, packaging, AF-7bv]
status: complete
last_updated: 2026-08-16
last_updated_by: GentleRiver
---

# Research: AF-7bv declaration emit and NodeNext consumption

**Date**: 2026-08-16T12:24:27-04:00  
**Researcher**: GentleRiver  
**Git Commit**: `2b41826d40d36af36c43150af497f8c1ebfe57aa`  
**Branch**: `nodenext-library-2026-08-16-12-15`  
**Repository**: `silmari-chat-agents`

## Research Question

How does the repository currently emit and validate published declaration files, and where do the five NodeNext-incompatible export entries differ from the nine clean entries?

Related beads: `AF-7bv` (library-wide declaration emit) and dependent subset `AF-sy8` (`./baml`).

## Summary

The runtime and declaration pipelines are separate. `tsdown` emits `.mjs` and `.cjs` files with rewritten aliases and fixed extensions, but has declaration emit disabled. The build then invokes TypeScript directly, under bundler resolution, to emit `dist/types`. No post-processing command runs on those declarations ([package.json:126](../../../../package.json), [tsdown.config.mjs:9](../../../../tsdown.config.mjs), [tsconfig.build.json:2](../../../../tsconfig.build.json)).

The published surface has 14 export entries. A real packed-package NodeNext probe confirms that five fail: `.`, `./baml`, `./openai`, `./responses`, and `./langchain`. The other nine `./langchain/*` leaves pass because their declaration entries contain only bare external package specifiers ([package.json:11](../../../../package.json), [probe research](2026-08-16-16-21-nodenext-exports-probe.md)).

The failure is broader than the five entry files. The generated tree contains 113 declaration files with `@/` specifiers and 63 declaration files with relative specifiers. The first broken barrel edge masks deeper alias failures, so compatibility depends on transforming the full emitted declaration tree as one build operation.

## Detailed Findings

### Declaration producer

- The build command is `tsdown && tsc -p tsconfig.build.json`; `prepublishOnly` runs that build before the packed-package gate ([package.json:127](../../../../package.json)).
- `tsdown` sets `dts: false`. Its `fixedExtension` and `alias` settings therefore govern runtime output, not declarations ([tsdown.config.mjs:9](../../../../tsdown.config.mjs)).
- The TypeScript pass emits declarations only into `dist/types` with `moduleResolution: "bundler"` ([tsconfig.build.json:2](../../../../tsconfig.build.json)).
- The inherited source mapping is `@/* -> ./src/*`, which TypeScript uses for resolution but preserves in emitted declarations ([tsconfig.json:13](../../../../tsconfig.json)).
- `tsc-alias` is already a development dependency, but no current script or configuration invokes it ([package.json:285](../../../../package.json)). A disposable-copy probe showed that stock `tsc-alias --resolve-full-paths` rewrites `@/` aliases but leaves relative declaration specifiers extensionless because it looks for sibling `.js` files, while this output tree contains `.d.ts` files.

### Declaration topology

- The root source barrel contains 46 extensionless relative specifiers, reflected directly in `dist/types/index.d.ts` ([src/index.ts:2](../../../../src/index.ts)).
- `src/langchain/index.ts` is eight relative re-exports; the emitted entry preserves all eight without extensions ([src/langchain/index.ts:1](../../../../src/langchain/index.ts)).
- `src/openai/index.ts` and `src/responses/index.ts` each import the exported event-handler namespace from `@/types`, emitted unchanged at line 1 of their declaration entries ([src/openai/index.ts:1](../../../../src/openai/index.ts), [src/responses/index.ts:1](../../../../src/responses/index.ts)).
- `src/llm/baml/index.ts` imports `./ChatBAML` and re-exports `./errors` and `./types`; the emitted entry preserves those three extensionless edges. Its transitive declarations also preserve aliases ([src/llm/baml/index.ts:1](../../../../src/llm/baml/index.ts)). This is the dependent `AF-sy8` subset.
- The nine direct `./langchain/*` facade entries re-export only external `@langchain/*` packages, so they do not contain either failing first-party specifier form.

### Published consumer gate

- B19 consumes an existing build, creates a real tarball, extracts it into a scratch consumer, and verifies the packed `./baml` artifacts ([test/package/run.mjs:66](../../../../test/package/run.mjs)).
- Its type matrix currently includes only bundler and node10. The source comment explicitly excludes NodeNext because of the declaration defects ([test/package/run.mjs:148](../../../../test/package/run.mjs)).
- Both configs compile `type-consumer.ts`, which imports only `@librechat/agents/baml`; there is no tracked `tsconfig.nodenext.json` and no 14-subpath consumer ([test/package/consumers/type-consumer.ts:1](../../../../test/package/consumers/type-consumer.ts)).
- The unchanged baseline remains green under `npm run build` followed by `npm run test:package`, proving the current gate does not observe NodeNext compatibility.

### Current 14-export result

| Export | Current result | Declaration evidence |
|---|---:|---|
| `.` | Fail: 46 `TS2834` | `dist/types/index.d.ts:1-54` |
| `./baml` | Fail: 3 `TS2834` | `dist/types/llm/baml/index.d.ts:1-4` |
| `./openai` | Fail: 1 `TS2307` | `dist/types/openai/index.d.ts:1` |
| `./responses` | Fail: 1 `TS2307` | `dist/types/responses/index.d.ts:1` |
| `./langchain` | Fail: 8 `TS2834` | `dist/types/langchain/index.d.ts:1-8` |
| Nine `./langchain/*` leaves | Pass | Direct bare-package facade declarations |

The exact packed-probe procedure and per-subpath results are recorded in [the independent 14-entry probe](2026-08-16-16-21-nodenext-exports-probe.md).

## Architecture Documentation

```text
src/**/*.ts
    |
    +-- tsdown (packageEntries) ----------> dist/esm + dist/cjs
    |                                      aliases and extensions rewritten
    |
    +-- tsc -p tsconfig.build.json ------> dist/types/**/*.d.ts
                                           source specifiers preserved
                                                      |
package.json exports.types ---------------------------+
                                                      |
npm pack -> scratch node_modules -> tsc consumer -----+
```

The runtime entry manifest and package export map each enumerate 14 entries, but TypeScript declaration emit is include-driven and emits the full `src/**/*` declaration graph rather than only those entry files ([config/package-entries.mjs:1](../../../../config/package-entries.mjs), [tsconfig.build.json:11](../../../../tsconfig.build.json)).

## Workflow Closure Map

### Prose map

1. **Depth 0 — source declarations** (`production-called`, unchanged node): `tsconfig.build.json:11` selects `src/**/*` as the declaration source of truth.
2. **Depth 1 — package build entrypoint** (`production-called`, changed connector): `package.json:129` invokes the runtime build and declaration emit. Publish invokes this at `.github/workflows/publish.yml:41-44`.
3. **Depth 2 — declaration emit** (`production-called`, changed connector): `tsc -p tsconfig.build.json` writes `dist/types`; it currently has no post-emit transformation.
4. **Depth 3 — packed export boundary** (`production-called`, unchanged node): `test/package/run.mjs:87-125` packages and extracts the same files npm publishes.
5. **Depth 4 — consumer observation** (`production-called` for bundler/node10, missing for NodeNext): `test/package/run.mjs:161-173` calls the real TypeScript executable and converts its exit status into the gate result. No NodeNext member currently exists.

All edges are synchronous. The declaration-emit-to-package and package-to-consumer edges cross build/package boundaries. The highest connector this slice changes is the package build entrypoint at depth 1. Failure is fail-closed where a configured consumer exists: a non-zero `tsc` exit increments `failures`, and the gate exits non-zero at `test/package/run.mjs:175-177`.

No Semgrep citation/closure scripts are present at the documented `SAI/skills/ResearchSemgrep` paths in this checkout. Structural and semantic claims above were verified with targeted source reads, generated-output inspection, an unchanged build, the existing package gate, and the independent packed NodeNext probe.

### ClosureMap (structured — derive() input)

```json
{
  "behavior": "A published @librechat/agents declaration entry is consumable by a real NodeNext TypeScript project.",
  "git_commit": "2b41826d40d36af36c43150af497f8c1ebfe57aa",
  "repo": "/home/maceo/ntm_Dev/nodenext-library-2026-08-16-12-15",
  "nodes": [
    { "id": "typescript-sources", "module": "src + tsconfig.build.json", "is_entrypoint": false, "adds_or_changes": false, "read_path": null, "seedable_store": "tsconfig.build.json" },
    { "id": "package-build", "module": "package.json scripts", "is_entrypoint": true, "adds_or_changes": true, "read_path": null, "seedable_store": null },
    { "id": "declaration-emit", "module": "TypeScript declaration build", "is_entrypoint": false, "adds_or_changes": true, "read_path": null, "seedable_store": null },
    { "id": "packed-package", "module": "test/package/run.mjs", "is_entrypoint": false, "adds_or_changes": false, "read_path": null, "seedable_store": null },
    { "id": "nodenext-consumer", "module": "test/package/run.mjs", "is_entrypoint": false, "adds_or_changes": true, "read_path": "run", "seedable_store": null }
  ],
  "edges": [
    { "is_async": false, "cross_boundary": true, "driver": null },
    { "is_async": false, "cross_boundary": false, "driver": null },
    { "is_async": false, "cross_boundary": true, "driver": null },
    { "is_async": false, "cross_boundary": true, "driver": null }
  ]
}
```

### Closure adapter (staged proposal — `2026-08-16-12-24-AF-7bv-nodenext-declaration-emit.closure-adapter.py`)

The sibling file is a research-stage proposal only. It is not imported, registered, or used by the package build.

## Historical Context

- [Providers.BAML Phase 0 handoff](../handoffs/general/2026-08-09_21-09-33_providers-baml-phase0-complete.md) records why the original B19 NodeNext consumer was removed and opened `AF-sy8`.
- [Independent NodeNext export probe](2026-08-16-16-21-nodenext-exports-probe.md) reproduces the current 5/14 result against a packed tarball.

## Open Questions

None. The current-state pipeline and failure surface are fully located; implementation choices belong to the following planning stage.
