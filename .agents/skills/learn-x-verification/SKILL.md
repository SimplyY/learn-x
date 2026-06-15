---
name: learn-x-verification
description: Require fresh, scope-matched evidence before claiming a Learn-X change is complete, fixed, generated, or safe. Use at the end of code, documentation, prompt, input, output, and Skill changes.
---

# Learn-X Verification

Do not convert confidence into a completion claim. Every claim must point to fresh evidence from the current change.

## Gate

Before saying a task is complete:

1. Identify each claim being made.
2. Choose the command or inspection that can prove that claim.
3. Run it after the final edit.
4. Read the exit code and relevant output.
5. Inspect the final diff and confirm only intended files changed.
6. Report passed checks, unverified areas, and residual risk separately.

Partial checks prove only their own scope. A successful build does not prove content quality; a clean diff does not prove runtime behavior.

## Scope Map

| Change | Minimum fresh evidence |
| --- | --- |
| `app/code/` | relevant `node --check`, tests when present, and `npm run build` |
| `learn-x-input` | targeted tests and a non-secret fixture or dry run |
| `learn-x-process` | targeted script run on a bounded period plus output inspection |
| `02_prompts/` or Chat Pack config | config/build check, prompt contract review, and representative evaluation cases |
| documentation | rendered Markdown inspection, path/command existence checks, and diff review |
| generated `_dist` files | source coverage, provenance fields, target period, and non-overwrite behavior |
| Memory migration | checked or explicitly confirmed candidates only, source retention, and diff review |

## Project Commands

Use only the commands relevant to the files changed:

```bash
npm run test:input:weread
node --check app/code/server.mjs
node --check app/code/public/app.js
node --check app/code/scripts/static-graph.mjs
npm run build
git diff --check
git status --short
```

Do not run collectors that require credentials merely to satisfy this gate. Report that external integration as unverified unless a safe fixture or user-authorized live check exists.

## Completion Report

Include:

- files changed and why;
- exact verification commands and outcomes;
- anything not verified;
- risks caused by existing dirty-worktree changes or external dependencies.

## Origin

Adapted for Learn-X from `verification-before-completion` by Jesse Vincent (`obra/superpowers`), discovered through `VoltAgent/awesome-agent-skills`. Both referenced repositories use MIT licenses; see `THIRD_PARTY_NOTICES.md`.
