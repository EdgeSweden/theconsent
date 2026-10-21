<!-- Title = squash-commit subject in Conventional Commits form,
     e.g. `feat(core): add config schema and validateConfig`. See docs/plan.md, Delivery. -->

## Package

<!-- The docs/progress.md row and tier, and the review file (docs/reviews/<package>.md). -->

## Why

<!-- What a reader cannot get from the diff. Becomes the commit body. -->

## Checks

<!-- The `pnpm check` summary. CI runs the same gate on this pull request. -->

## Checklist

- [ ] Tests cover the behaviour this package adds or changes
- [ ] `CHANGELOG.md` updated under Unreleased, or nothing user-visible changed
- [ ] `docs/decisions.md` appended, or nothing durable was decided
- [ ] No real site, brand, domain or endpoint in the demo, tests or docs
- [ ] Nothing in the change breaks the plan's Public repository neutrality
