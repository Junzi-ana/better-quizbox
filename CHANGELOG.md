# Changelog

## 3.2.0 — 2026-10-08

- Automatic block IDs: each quiz block gets a content-derived base36 id (letters + digits, case-insensitive, length 4–10 default 7) written as `<!-- id: ... -->`. Editing a block updates its id on the next save. The hash covers the whole question (stem + options), so any change to the question changes the id.
- A "Renumber all block IDs" button rewrites every quiz block's id in the vault from its content, keeping ids unique per file.
- Block binding rewritten: `<!-- bind: <id> -->` renders a read-only static copy of the target question (stem omitted by default, settable; `<!-- stem: on -->` to keep it); `<!-- copy: <id> -->` renders an editable copy preserving the target's mode. Both follow the target's current displayed option order (post-shuffle). Lookup is O(1) via an in-memory vault-wide id index. An unresolved refer produces no binding (the block renders normally). bind/copy blocks themselves get no id.
- When a question's id changes after editing, every `bind`/`copy` referencing the old id is rewritten to the new id automatically (reverse-reference index, no vault-wide scans). Id updates and reference rewrites are merged into a single disk write per file, so bound blocks sync without triggering extra source-question re-renders. The same propagation runs for the "Renumber all block IDs" button.
- Bound/copy blocks re-render promptly when the target question changes: an in-memory registry tracks rendered bound blocks and re-renders only the affected ones on note edits (no full-vault rescans, no view switching needed).
- Launch fix: the vault-wide id index builds after Obsidian finishes loading the workspace, and bound blocks that rendered before the index was ready are re-rendered automatically — no more blank or unbound cards on startup.
- While a note is open in the editor, id changes are staged in memory (old ids keep resolving) and written to disk once editing ends, so typing never conflicts with the editor buffer.
- Settings panel localized to Chinese.

## 3.1.0

- Added a settings tab with three defaults: answer mode, option shuffling, and option numbering. Explicit block attributes still win; `<!-- number: none -->` now works as an explicit "no labels" override.

## 3.0.0 — 2026-10-06

Initial release.

- Interactive multiple-choice quiz blocks via ` ```quiz ` code blocks.
- Transient-only answering: responses live in memory, notes are never modified.
- Three answer modes: `static`, `immediate`, `non-immediate` (multi-select with 2+ correct options).
- Multi-line Markdown and LaTeX in questions, options, and explanations.
- Automatic option shuffling with a stable order shared across card faces; static blocks can follow a dynamic block's order via `bind`.
- Optional `abc` / `123` numbering labels; duplicate options are deduplicated.
- Flip-facing in spaced-repetition review preserves option order and previous answers.
