# Changelog

## 3.0.0 — 2026-10-06

Initial release.

- Interactive multiple-choice quiz blocks via ` ```quiz ` code blocks.
- Transient-only answering: responses live in memory, notes are never modified.
- Three answer modes: `static`, `immediate`, `non-immediate` (multi-select with 2+ correct options).
- Multi-line Markdown and LaTeX in questions, options, and explanations.
- Automatic option shuffling with a stable order shared across card faces; static blocks can follow a dynamic block's order via `bind`.
- Optional `abc` / `123` numbering labels; duplicate options are deduplicated.
- Flip-facing in spaced-repetition review preserves option order and previous answers.
