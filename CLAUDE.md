# CLAUDE.md — AutoShiftGenerator (Tier 3)

Project-specific rules. Tier 1 (`GitHub/CLAUDE.md`) and Tier 2 (`GitHub/GAS/CLAUDE.md`)
apply first; nothing here contradicts them.

---

## What this project is

A port of the Excel VBA `Auto_Shift_Generator` (11 modules, ~8,900 lines) to
Google Apps Script + Google Sheets. It builds a pharmacy staff shift roster.

**Read `docs/GAS-PORTING-SPEC.md` before writing any code.** It is the contract
for this port: module mapping, sheet schema, the placement algorithm step by step,
formula incompatibilities, and the trap checklist (§10).

---

## This stopped being a port in 2026-09

It began as a port. It is now a rewrite, driven by 13 months of the real roster
(`docs/REAL-SHIFT-ANALYSIS.md`). The following deliberately differ from the VBA
version — do not "fix" them back:

- Placement is managed **week by week**, not day by day.
- 公休 lands **exactly on quota**. Anything beyond it uses 有休 / 夏休.
- The **weekday floor is not used** to set required headcount. Headcount comes from
  the doctor count. The floor is a stand-in for days with no doctor entered
  (`rules.weekdayFloor`, default `off`).
- Default 連続出勤上限 is **4 days**, not 3 (4-day runs are 41% of the real data).
- 医師名欄 is **variable** (3–10 rows, default 6), not fixed at 5.

**The bar for "correct" is the real roster, not the VBA output.** When a step
disagrees with the VBA version, check it against `docs/REAL-SHIFT-ANALYSIS.md`
first; only treat it as a porting bug if the real data does not settle it.

The VBA source stays useful as a reference for *intent* and for the parts nobody
has re-derived yet: `GitHub/VBA/Auto_Shift_Generator/src/*.bas` — **read-only**.
Never modify it (Tier 1: no cross-project modification).

Keep the `移植元:` line in a function's JSDoc where it is still true. For code that
no longer traces to a VBA procedure, say what it is derived from instead
(a section of the spec, or a finding in the analysis doc).

---

## Hard rules for this codebase

### The placement engine never touches `SpreadsheetApp`

The engine is a pure function: arrays in, arrays out. That is what makes it
testable and what keeps it inside the 6-minute limit. The VBA version read
`mGrid.Cells(i,j).Value` mid-process in five places (§8.3-1) — those all become
reads of an array captured up front.

If you find yourself needing a sheet value inside the engine, the value belongs in
the input instead.

**Where the engine lives:** in the browser, inside `prototype/ShiftGrid.html`.
The deployment plan (`docs/DEPLOY-PLAN.md`) keeps it there and gives the server
only reading, writing and access control. `Engine.gs` and `ShiftAuto.gs` are
therefore **not being implemented** — their stubs stand as a record of the spec,
not as work to do. If a server-side scheduled run is ever needed, that decision
gets revisited then.

### Read and write in whole ranges, once

`getValues` / `getFormulas` / `getBackgrounds` / `getFontWeights` before the process,
`setValues` / `setBackgrounds` / `setFontWeights` after it. `flush()` once at the end.
Never per-cell in a loop (Tier 2 prohibits it, and here it also breaks the time limit).

### `Layout.resolveLayout()` is called once per execution

Resolve positions once and pass the object around. The VBA version re-resolved on
every call; that pattern does not survive the port.

### The server stores; it does not validate cell placement

This changed in 2026-09. The old web app wrote shift symbols straight into
spreadsheet cells, so a symbol landing in the doctor block inflated `医師数(診)`
(a `COUNTA` over that block) and threw off the whole month. `stampRejectReason_()`
was the server-side guard against that. **That path is gone** — the view and its
APIs were deleted because they wrote to a different place than the editor does.

Shift data now goes to a JSON blob in a hidden sheet (`Store.gs`). There are no
formulas over it, so a misplaced symbol cannot silently change a headcount; the
browser's own `stampRejectReason()` is what keeps the grid coherent.

**What the server does still own is conflict detection.** `storeWrite_()` refuses
a write whose base revision has moved. Never bypass it — passing `force` is a
choice the *user* makes in the conflict bar, not something the client decides.

What is still missing: the server does not check *who* is writing (`Auth.gs` has
no member reader yet). Until it does, anyone who can reach the web app can write.

### Existing input is never overwritten

`ST_FWORK` / `ST_FOFF` (cells the user already filled) are read-only to every
automatic step. The whole promise of the tool is "fill the blanks, keep what I typed."

### Constants live in `Config.gs`

No sheet name, label, column number, row offset, ID, or URL anywhere else
(Tier 1 "No Hard-Coded Paths", Tier 2 "Configuration").

### Never write a real doctor's or staff member's name into code

Doctor names come from the config sheet or from what is already on the shift sheet.
`Survey.gs` masks names (`MASK_NAMES`). This is a live workplace tool with real
personal data in it.

---

## GAS-specific gotchas that have already bitten this port

- **File names must be unique across extensions.** Apps Script stores a name and a
  type, so `WebApp.gs` and `WebApp.html` collide — the editor refuses the second one.
  Pair a server file with a differently-named view: `WebApp.gs` + `WebAppView.html`.
  `tests/pure.test.js` guards this.
- **All `.gs` files share one global scope.** Top-level `const` and `function` names
  must be unique across the whole project. Per-file module names are therefore
  `MODULE_ENGINE`, `MODULE_LAYOUT`, … not a repeated `MODULE_NAME`. A duplicate is a
  load-time error, so it takes the whole project down, not just one file.
  `tests/pure.test.js` guards this too.
- **`MATCH` does not accept an array in Sheets.** It silently reads only the first
  element and returns a wrong headcount with no error. The pharmacist-count formula
  uses a hidden helper column (`AN`) instead — see §5.3 and `Setup.gs`.
- **Named ranges cannot hold a formula in Sheets**, only an address. `Layout.gs` is
  the authority; named ranges are signposts for the user.
- **No cell events, and no selection in a web app.** No `SelectionChange`,
  `BeforeDoubleClick`, `BeforeRightClick`; `getActiveRange()` does not exist in a web
  app either. Input is the web app's own grid (`WebApp.gs` / `WebAppView.html`), which
  tracks the clicked cell itself. The old sidebar skeleton is in `archive/`.
- **No Japanese-era (和暦) number format.** Western year only.

---

## Conventions

- Function names: camelCase English. Japanese only in menu labels, UI text, sheet
  names, and comments (Tier 2).
- A trailing `_` means "internal to this module" (GAS convention: such functions are
  not exposed to `google.script.run` or the trigger menu).
- Stubs call `notImplemented_(module, func, phase)` where `phase` is the
  implementation phase from spec §9. Grep `TODO(P3)` to find what is left in a phase.
- Every implemented function gets `try/catch` + `console.error` (Tier 2). Stubs do
  not — add it when you write the body.
- Anything pure goes in `tests/pure.test.js` (`node tests/pure.test.js`). It runs the
  `.gs` files in a `vm` with stubbed GAS globals — no spreadsheet needed. Note the
  cross-realm traps: `instanceof Date` and `deepStrictEqual` fail on values built
  outside the vm, so construct them with `vm.runInContext` or copy with `Array.from`.
- Call `logSuccess()` on normal completion. The VBA-era practice of judging test
  results from the log continues here. Include `elapsedMs` for the auto-generation run.

---

## Verifying it

Because the engine is pure, correctness is checked mechanically — but **against the
real roster, not against the VBA output**:

1. `node prototype/tests/*.test.js` — 9 suites, no spreadsheet needed.
2. Feed a real month's input (masters + doctor roster) and compare the generated
   sheet with what the store actually ran that month.
3. Differences are judged against `docs/REAL-SHIFT-ANALYSIS.md`. The measured
   relationships are the yardstick: 薬剤師 ≈ 0.612 × 医師 + 1.984, 公休 exactly on
   quota, 4-day runs normal.

Do not skip step 1. The fixtures under `prototype/samples/` exist for it, and
`dispatch.test.js` runs 13 doctor patterns × 3 dispatch levels in one go.
