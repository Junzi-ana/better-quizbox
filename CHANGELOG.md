# Changelog

## 3.5.0 — 2026-10-13

- Favorite button: a star button on each quiz block (top-right in editing view, floating on the block in reading view). Click to favorite/unfavorite a question; favorites persist in plugin data. The button's position adapts to whoever occupies the corner (the native `</>` source button, quote buttons from other plugins) via live DOM measurement, and the star state syncs instantly between editing and reading views.
- Favorites are registered by question id: a question and all of its `bind`/`copy` mirrors share the same favorite — favoriting (or unfavoriting) any of them counts for the source question. Favorites saved under the older card-key format are migrated automatically on load.
- Favorites panel (experimental, opened from the star icon in the left ribbon): lists favorited questions grouped by source file with collapsible groups, per-group counts, the question id, and a single-line stem preview; clicking a row jumps to the source note. Unfavoriting from the panel keeps the star buttons on blocks in sync.
- Factory presets: out-of-the-box defaults now match the author's daily configuration — `non-immediate` answer mode, A/B/C numbering, manual reset (graded state kept until Reset), auto id assignment with 6-char codes, stems kept in `bind` blocks, tuned submit/reset button appearance and verdict-text templates. Debug logging stays off and the renumber exclude list starts empty.

## 3.4.0 — 2026-10-11

- New submit-and-grade flow for `non-immediate` mode (its main use): after selecting options, a Submit button appears at the bottom-right of the block. Pressing it grades the answer — chosen-wrong options turn red ✗, missed-correct ones are revealed green ✓ — expands the explanation, shows a verdict line, and locks the block until reset. Works for both single-answer and multiple-answer questions.
- Configurable grading: Reset behavior is selectable per plugin/block (`<!-- reset: auto|manual -->`). Auto resets the question whenever the note is re-rendered (page switches); Manual keeps the graded state (and your selections) across views until you press Reset, which re-randomizes and clears the block.
- Fully customizable verdict text in settings (`{ans}` = correct-answer letters, `{pick}` = your-selection letters), so translations and phrasing are up to you.
- Button appearance settings: per-button accent-color blend ratio, hover brighten/darken amount (-1..1 slider), foreground color (auto / anti-auto / white / black, using near-white/near-black designer tones), font weight, and a one-click swap of the two buttons' configurations. Buttons use Obsidian theme variables so they adapt to any theme.
- Settings panel reorganized into titled groups (Answering, Grading, Question IDs, Others) with collapsible sections for testing/tuning items.
- Renumber-all-IDs: added an exclude-list setting (paths per line) so protected folders/files are skipped during renumbering; renumbering is now idempotent (already-correct ids cause zero writes, so repeated clicks finish instantly instead of rewriting the whole vault) and yields to the UI thread in batches.
- Fixed the file-hash prefix bug where every file's prefix collapsed to `000…` (padding leaked into the sliced prefix); prefixes now come from the tail of the base36 digest and spread properly across files.
- Hardened live-binding notifications: order broadcasts fire only when the displayed order actually changed, notifications coalesce recursively with a chain-depth cap, and self-triggered modify events are suppressed during bulk renumbering — eliminates the render-storm freeze when editing with many bound blocks.
- Bind/copy block-attribute parsing extended with `submit` and `reset` keys (illegal values claim no slot; case-insensitive).

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
