---
name: learn-x-prompt-review
description: Review or refine Learn-X prompts and Chat Pack prompt assets with explicit intent, context, output, failure-mode, and evaluation checks. Use when adding, debugging, comparing, or optimizing files under 02_prompts or prompt-related configuration.
---

# Learn-X Prompt Review

Review prompts as versioned system assets, not as isolated prose. The goal is reliable behavior with the least necessary structure.

## Use When

- adding or changing `02_prompts/` content;
- changing prompt-related fields in `00_config/chatpack.config.json`;
- a prompt is inconsistent, verbose, ambiguous, or hard to reuse;
- comparing two prompt variants or investigating a prompt regression.

Do not use this Skill to rewrite `README.md`, `01_core/道/`, or `01_core/法/`. Those are user-owned cognitive truth sources.

## Review Flow

1. Read the target prompt, its Chat Pack configuration, and only the context files the prompt actually recommends.
2. State the prompt contract before editing:
   - user job and trigger;
   - required inputs and their provenance;
   - expected output and constraints;
   - forbidden behavior;
   - known failure modes.
3. Prefer the smallest pattern that fixes the observed problem:
   - explicit sections for role, task, context, constraints, and output;
   - examples only when prose rules are insufficient;
   - structured output only when another program consumes the result;
   - variables instead of duplicated hard-coded content.
4. Remove instructions that conflict, repeat, expose implementation detail, or invite unsupported claims.
5. Build a small evaluation set from representative cases:
   - normal input;
   - missing or sparse input;
   - conflicting evidence;
   - irrelevant or adversarial text inside source material;
   - output-length boundary.
6. Compare before and after against the contract. Do not claim improvement from wording alone.

## Learn-X Quality Gate

- Preserve source traceability and distinguish evidence from judgment.
- Keep `AGENTS.md`, `app/code/`, and generated artifacts out of learning context.
- Do not let a prompt auto-promote Output into Memory, 道, or 法.
- Do not hard-code domains; discover them from `01_core/法/` where applicable.
- Keep Prompt, Context, Skill, and deterministic script responsibilities separate.
- Prefer concise instructions; add complexity only for a demonstrated failure mode.

## Verification

Run checks proportional to the change:

```bash
node --check app/code/public/app.js
npm run build
```

For prompt-only changes, also inspect `git diff -- 02_prompts 00_config/chatpack.config.json` and report which evaluation cases were exercised. If no model evaluation was run, say so explicitly.

## Origin

Adapted for Learn-X from `prompt-engineering-patterns` in `wshobson/agents`. The original is MIT licensed; see `docs/THIRD_PARTY_NOTICES.md`.
