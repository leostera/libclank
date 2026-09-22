# Implementation plan guidance

Files in this directory are durable implementation handoffs for future agents and contributors. A plan must be understandable and executable without relying on the conversation that created it.

## Before creating a plan

1. Read the repository `README.md`, relevant source, tests, and design documents.
2. Read any applicable RFD completely. An accepted/proposed RFD owns architectural rationale; a plan tracks execution.
3. Read existing plans that overlap the work. Extend or supersede them instead of creating competing checklists.
4. Check `git status` and recent history so the plan describes the current tree.
5. Record verified current behavior. Do not present intended behavior as already implemented.

## Naming and ownership

- Use `PLAN####-short-title.md` for standalone plans, allocating the next unused number.
- Use `RFD####-implementation-checklist.md` for a plan attached to an RFD.
- Do not renumber existing plans.
- Link bidirectionally between an RFD and its implementation checklist.
- Keep design decisions in the RFD. If implementation requires changing the contract, update the RFD rather than silently changing only the plan.

## Required plan structure

A new plan should contain:

1. **Title and status** — `Proposed`, `In Progress`, `Blocked`, `Completed`, or `Superseded`.
2. **Goal** — the concrete user/operator/contributor outcome.
3. **Context and current baseline** — relevant packages, behavior, constraints, and known gaps, with repository-relative paths.
4. **Scope and non-goals** — boundaries that prevent incidental expansion.
5. **Invariants or decisions** — contracts an implementer must preserve. Link to the owning RFD where applicable.
6. **Milestones** — ordered, independently reviewable batches.
7. **Tasks** — checkboxes with specific code locations and observable completion conditions.
8. **Validation** — exact commands and behavioral tests, including failure and recovery cases where relevant.
9. **Acceptance criteria** — a finite definition of done.
10. **Open questions/blockers** — unresolved choices, owner if known, and what work they block.
11. **Progress log** — dated handoff notes for material discoveries, deviations, and next actions.

Small plans may combine sections, but they must still provide enough context, validation, and acceptance criteria for another agent to continue safely.

## Writing actionable tasks

Each task should say what changes, where it changes, and how completion is observed.

Prefer:

```md
- [ ] Add a per-run `sequence` column and unique index in
      `packages/scheduler/src/migrations.ts`; prove same-millisecond event writes
      are returned in commit order in the local SQLite integration test.
```

Avoid:

```md
- [ ] Fix events.
- [ ] Improve tests.
```

Guidelines:

- Name affected files or packages when known.
- Separate behavior changes, migrations, tests, and documentation when they can fail independently.
- Include compatibility and rollback/migration work.
- Include negative, concurrency, restart, and partial-failure tests for durable systems.
- Do not use a checkbox for an unresolved design question; put it under open questions.
- Avoid speculative implementation detail unless it is a decided constraint.
- Prefer milestones that can land while keeping `main` buildable.
- Include suggested PR or commit boundaries for multi-package work.

## Following up on a plan

When implementing from a plan:

1. Re-read the relevant source and verify that the baseline is still current.
2. Set the plan status to `In Progress` before material implementation begins.
3. Work milestone-by-milestone unless a dependency requires reordering; record reordering in the progress log.
4. Mark a checkbox complete only after its implementation and stated validation pass.
5. Add newly discovered required work to the appropriate milestone. Do not hide scope changes in prose or commits.
6. Record blockers immediately with enough detail for another agent to reproduce them.
7. After each implementation batch, add a dated progress-log entry containing:
   - completed tasks or milestone;
   - important files changed;
   - validation commands and results;
   - decisions or deviations;
   - exact next recommended task.
8. Keep checked items in place as history. Do not rewrite the plan to make unfinished work appear complete.
9. Set status to `Completed` only when all acceptance criteria pass. Use `Superseded` with a link when another plan replaces it.

Example progress entry:

```md
### 2026-09-22 — Event sequencing landed

- Completed Milestone 1 event sequence storage and read ordering.
- Changed `packages/scheduler/src/sqlite-schema.ts` and
  `packages/local/src/scheduler-database.ts`.
- Validation: `bun run test:unit` passed after narrowing the Vitest target to the affected packages.
- Deviation: used a composite `(run_id, sequence)` primary key; RFD contract is unchanged.
- Next: implement stale claim-token rejection in `completeNode`.
```

## Validation and honesty

- Run the narrowest relevant checks during development and the plan's full validation before completion.
- Report commands that could not run and why; never mark their tasks complete.
- Distinguish test doubles from real SQLite, Worker emulator, or external integration coverage.
- Do not claim production guarantees without executable tests for those guarantees.
- Run formatting or Markdown checks and `git diff --check` for plan-only changes.
- Never include secrets, credentials, private payloads, or copied production data in a plan or progress log.
