# Changelog

## 3.3.0 — 2026-10-09

- Block IDs are now stable counter numbers instead of content hashes: `<!-- id: ... -->` = file-name hash prefix + block number, with an adjustable code length (3–9; half goes to the hash, the other half to a zero-padded block number, odd lengths give the hash the extra digit). An id, once assigned, is never rewritten — editing a question's stem or options no longer changes its id, so `bind`/`copy` references never break and no reference-rewriting or deferred writes are needed.
- Block IDs are assigned only to blocks that lack one (new blocks). A "Renumber all block IDs" button renumbers every block per file from 0, with a cross-file collision guard (shared id set skips numbers already taken by another file sharing the same hash prefix).
- Editing is now stable: the plugin performs zero disk writes when you edit an existing question (the id doesn't change), so the front card no longer flickers from plugin-triggered re-renders. Option order is preserved while you edit the stem/explanations (carried over when the option set is unchanged); a bound card shows the target's current content and order and only rebuilds once per change.
- Card transient state (order + answers) is keyed by file+id (stable), so editing the stem keeps the order and previous answers; changing the actual options re-shuffles as before.

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
