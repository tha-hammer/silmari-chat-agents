---
date: 2026-08-16T12:21:29-04:00
researcher: ChartreusePuma
git_commit: 2b41826d40d36af36c43150af497f8c1ebfe57aa
branch: nodenext-library-2026-08-16-12-15
repository: silmari-chat-agents
topic: 'AF-sy8 current ./baml declaration path and NodeNext consumption failure'
tags: [research, codebase, typescript, nodenext, node16, declarations, packaging, baml, AF-sy8]
status: complete
last_updated: 2026-08-16
last_updated_by: ChartreusePuma
---

# Research: AF-sy8 `./baml` declarations under NodeNext

**Date**: 2026-08-16T12:21:29-04:00  
**Researcher**: ChartreusePuma  
**Git Commit**: `2b41826d40d36af36c43150af497f8c1ebfe57aa`  
**Branch**: `nodenext-library-2026-08-16-12-15`  
**Repository**: `silmari-chat-agents`

## Research Question

How does the published `@librechat/agents/baml` type surface currently travel from source through declaration emit and the B19 packed-package gate, and where does NodeNext/Node16 consumption stop?

Related beads: `AF-sy8` (this BAML subset) and prerequisite `AF-7bv` (library-wide declaration emit).

## Summary

`./baml` is a separate, side-effectful public entry. Its source barrel registers `ChatBAML`, then exports the class, the five BAML error classes, `BAML_PORT_VERSION`, and the host port types ([src/llm/baml/index.ts:1](../../../../src/llm/baml/index.ts), [types.ts:5](../../../../src/llm/baml/types.ts), [errors.ts:8](../../../../src/llm/baml/errors.ts)). The package maps both `exports.types` and `typesVersions` to `dist/types/llm/baml/index.d.ts` ([package.json:17](../../../../package.json)).

Runtime and declaration artifacts take different build paths. `tsdown` emits extension-clean `.mjs` and `.cjs` modules, while the following `tsc -p tsconfig.build.json` command emits declarations under bundler resolution and preserves source specifier spelling ([package.json:126](../../../../package.json), [tsdown.config.mjs:9](../../../../tsdown.config.mjs), [tsconfig.build.json:2](../../../../tsconfig.build.json)). The generated BAML declaration barrel therefore contains extensionless `./ChatBAML`, `./errors`, and `./types` edges; its reachable declarations also retain `@/` aliases.

A no-emit TypeScript 5.5.3 probe fails under both `moduleResolution: "nodenext"` and `"node16"`. The barrel produces three `TS2834` diagnostics at `dist/types/llm/baml/index.d.ts:1,3,4`, and the public consumer consequently reports every imported BAML member as missing. Direct leaf probes expose the second layer: `ChatBAML.d.ts`, `errors.d.ts`, `types.d.ts`, and `toolBinding.d.ts` contain `@/` aliases that a package consumer cannot resolve.

B19 currently proves packed ESM/CJS registration and BAML type consumption under bundler and node10 only. Its source comment explicitly excludes NodeNext, and no `test/package/consumers/tsconfig.nodenext.json` exists ([test/package/run.mjs:148](../../../../test/package/run.mjs)). The unchanged baseline build and package gate both pass, so their current green result does not observe AF-sy8.

## Detailed Findings

### Public BAML source surface

- `src/llm/baml/index.ts:1-10` imports the shared registry, `ChatBAML`, and `Providers`, then registers BAML during module evaluation.
- `src/llm/baml/index.ts:12-14` exports `ChatBAML` and star-re-exports `errors.ts` and `types.ts`.
- `src/llm/baml/types.ts:5-133` defines the literal port version, declared/selected tools, transcript and result unions, `BamlFunctionSet`, and `BamlClientOptions`.
- `src/llm/baml/errors.ts:8-100` defines the five public error classes exercised by the package consumer.
- The root barrel exports `getChatModelClass` and `initializeModel`, but does not import or re-export the BAML entry ([src/index.ts:71](../../../../src/index.ts)). This preserves the root-only negative registration behavior.

### Package routing

`package.json:17-22` maps `./baml` to:

| Condition | Published artifact |
| --- | --- |
| `import` | `dist/esm/llm/baml/index.mjs` |
| `require` | `dist/cjs/llm/baml/index.cjs` |
| `types` | `dist/types/llm/baml/index.d.ts` |

`package.json:83-87` mirrors the declaration path through `typesVersions`. The package is ESM-scoped with `"type": "module"` (`package.json:102`), so the `.d.ts` entry is interpreted as an ECMAScript declaration module by NodeNext/Node16.

### Emit topology

```text
src/llm/baml/**/*.ts
    |
    +-- tsdown (packageEntries) ------> dist/esm + dist/cjs
    |                                  explicit .mjs/.cjs specifiers
    |
    +-- tsc -p tsconfig.build.json --> dist/types/**/*.d.ts
                                       source specifiers preserved
                                                  |
package.json exports.types/typesVersions --------+
                                                  |
npm pack -> scratch node_modules -> tsc consumer -+
```

- `config/package-entries.mjs:1-4` names the BAML runtime entry.
- `tsdown.config.mjs:9-20` disables declaration emit, preserves the source module tree, forces runtime extensions, and resolves the runtime `@` alias.
- `tsconfig.build.json:2-20` independently emits declarations from `src/**/*` under `moduleResolution: "bundler"`.
- `tsconfig.json:13-16` supplies the source-only `@/* -> ./src/*` path mapping.
- `tsc-alias@1.8.10` is installed but is not invoked or configured anywhere in the current build (`package.json:310`).

### Generated BAML declaration graph

The current generated entry is:

```ts
import { ChatBAML } from './ChatBAML';
export { ChatBAML };
export * from './errors';
export * from './types';
```

(`dist/types/llm/baml/index.d.ts:1-4`)

NodeNext/Node16 reject lines 1, 3, and 4 before following the edges. Once followed, the reachable graph contains these private source aliases:

| Declaration | Preserved `@/` specifier(s) |
| --- | --- |
| `ChatBAML.d.ts:10-12` | `@/llm/baml/types`, `@/llm/baml/toolBinding`, `@/types` |
| `errors.d.ts:1` | `@/llm/baml/types` |
| `types.d.ts:2-3` | `@/types/llm`, `@/session` |
| `toolBinding.d.ts:2-3` | `@/llm/baml/types`, `@/types` |

`callMeta.d.ts:2` and `transcript.d.ts:2` show the same retained alias pattern elsewhere in the BAML declaration directory. These generated files are ignored build products (`.gitignore:3`), not tracked source.

### Current packed-package gate

`test/package/run.mjs`:

1. Requires the prebuilt ESM, CJS, and declaration BAML entries (`:42-72`).
2. Creates a differently named scratch package, runs `npm pack`, extracts it, and verifies the advertised artifacts shipped (`:74-125`).
3. Runs ESM/CJS positive registration consumers and a root-only negative consumer (`:127-146`).
4. Runs the shared BAML type consumer under bundler and node10 (`:148-173`).

`test/package/consumers/type-consumer.ts:7-39` imports the port version, three public port types, and all five error classes through `@librechat/agents/baml`. The current type matrix contains `tsconfig.bundler.json` and `tsconfig.node10.json`; the repository contains no NodeNext or Node16 consumer config.

### Observed failure

The public consumer probe used:

```text
tsc --noEmit --module nodenext --moduleResolution nodenext \
  --target es2022 --lib es2022 --strict --skipLibCheck \
  test/package/consumers/type-consumer.ts
```

It exits `2` and reports nine `TS2305` missing-export diagnostics. With declaration checking enabled, the same run also reports the underlying three `TS2834` diagnostics. Repeating it with `module`/`moduleResolution: node16` produces the same failure groups. Directly naming the BAML leaf declarations exposes `TS2307` for the `@/` specifiers listed above.

The independent packed probe records `./baml` as one of exactly five failing export subpaths; all nine `./langchain/*` leaves pass ([NodeNext export probe](2026-08-16-16-21-nodenext-exports-probe.md)).

## Architecture Documentation

The BAML declaration defect is a dependent subset of the package-wide emit behavior. The declaration emitter walks the complete source tree, not only the 14 public entries, and preserves both extensionless relative specifiers and private aliases. The public BAML barrel currently stops at the first category and masks the second category in the declarations it would otherwise reach.

Runtime registration and type consumption are distinct observables in B19. ESM/CJS registration succeeds because tsdown rewrites runtime specifiers. NodeNext type consumption fails before any runtime evaluation because TypeScript cannot traverse the published declaration graph.

## Workflow Closure Map

### Prose map

1. **Depth 0 — BAML source surface** (`production-called`, unchanged source node): `src/llm/baml/index.ts:1-14` and its reachable type/error/class declarations define the public source of truth.
2. **Depth 1 — package build entrypoint** (`production-called`, changed connector): `package.json:129` invokes runtime build and declaration emit; `prepublishOnly` invokes the build before B19.
3. **Depth 2 — declaration emit** (`production-called`, changed connector): `tsc -p tsconfig.build.json` writes `dist/types`; the current chain has no declaration postprocessor.
4. **Depth 3 — advertised BAML type entry** (`production-called`, unchanged package boundary): `package.json:17-20,83-87` points consumers to `dist/types/llm/baml/index.d.ts`.
5. **Depth 4 — packed consumer gate** (`production-called` for the existing matrix, changed NodeNext observable): `test/package/run.mjs:161-173` executes TypeScript configs and converts non-zero exits into a failed B19 result. NodeNext is currently absent.

All edges are synchronous. The declaration-emit-to-package and package-to-consumer edges cross build/package boundaries. The highest connector under discussion is the package build entrypoint at depth 1. Configured consumers fail closed: a non-zero TypeScript exit increments `failures`, and B19 exits non-zero at `test/package/run.mjs:175-177`.

The documented Semgrep citation and closure scripts are absent from `SAI/skills/ResearchSemgrep/` in this checkout. Claims were verified through full source reads, generated-output inspection, an unchanged build, the current packed-package gate, direct NodeNext/Node16 probes, and the independent packed 14-entry probe.

### ClosureMap (structured — derive() input)

```json
{
  "behavior": "The packed @librechat/agents/baml entry exposes its public types to a real NodeNext TypeScript consumer.",
  "git_commit": "2b41826d40d36af36c43150af497f8c1ebfe57aa",
  "repo": "/home/maceo/ntm_Dev/nodenext-library-2026-08-16-12-15",
  "nodes": [
    { "id": "baml-source-surface", "module": "src/llm/baml", "is_entrypoint": false, "adds_or_changes": false, "read_path": null, "seedable_store": "src/llm/baml/index.ts" },
    { "id": "package-build", "module": "package.json scripts", "is_entrypoint": true, "adds_or_changes": true, "read_path": null, "seedable_store": null },
    { "id": "declaration-emit", "module": "tsconfig.build.json", "is_entrypoint": false, "adds_or_changes": true, "read_path": null, "seedable_store": null },
    { "id": "baml-types-export", "module": "package.json exports/typesVersions", "is_entrypoint": false, "adds_or_changes": false, "read_path": null, "seedable_store": null },
    { "id": "baml-nodenext-consumer", "module": "test/package/run.mjs", "is_entrypoint": false, "adds_or_changes": true, "read_path": "run", "seedable_store": null }
  ],
  "edges": [
    { "is_async": false, "cross_boundary": true, "driver": null },
    { "is_async": false, "cross_boundary": false, "driver": null },
    { "is_async": false, "cross_boundary": true, "driver": null },
    { "is_async": false, "cross_boundary": true, "driver": null }
  ]
}
```

### Closure adapter (staged proposal — `2026-08-16-12-21-AF-sy8-nodenext-baml-declarations.closure-adapter.py`)

The sibling file is a research-stage proposal only. It is not imported, registered, or used by the package build.

## Historical Context

- [Original BAML integration research](2026-08-09-13-21-llm-interface-baml-integration.md) documents the runtime provider and packaging seams before implementation.
- [Providers.BAML Phase 0 plan](../plans/2026-08-09-15-57-tdd-providers-baml-phase0.md) defines B19 as a packed-package closure that originally included a NodeNext type consumer.
- [AF-7bv declaration-emit research](2026-08-16-12-24-AF-7bv-nodenext-declaration-emit.md) documents the package-wide root cause on which AF-sy8 depends.
- [Independent 14-entry NodeNext probe](2026-08-16-16-21-nodenext-exports-probe.md) confirms the current five failures and nine passing leaves.

## Related Research

- `AF-7bv`: `thoughts/searchable/shared/research/2026-08-16-12-24-AF-7bv-nodenext-declaration-emit.md`
- Export matrix: `thoughts/searchable/shared/research/2026-08-16-16-21-nodenext-exports-probe.md`

## Open Questions

None. The current BAML declaration path, failure layers, and missing consumer gate are fully located; implementation choices belong to the planning stage.
