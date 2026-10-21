# Releasing

Releases are published by `.github/workflows/release.yml` from a `vX.Y.Z` tag on `main`
(plan: Releases). Nothing is published from a machine, and no npm token exists anywhere.

## Every release

1. A release pull request sets `version` in `package.json` and moves the `Unreleased` entries in
   `CHANGELOG.md` under `## [X.Y.Z] - YYYY-MM-DD`, with a fresh empty `Unreleased` above it. The
   implementer runs `pnpm check`; the release is reviewed like any other package.
2. The maintainer commits the release branch and runs the release gate on it before opening the
   pull request (the gate needs a clean tree, so it cannot run before the commit):

   ```sh
   pnpm build && pnpm release:check vX.Y.Z
   ```

   If it refuses, the fix is made on the branch and gets a targeted review before merge.

3. The pull request is squash-merged once CI is green, and CI on `main` passes.
4. The maintainer tags the merge commit and pushes the tag:

   ```sh
   git switch main && git pull --ff-only
   git tag -a vX.Y.Z -m vX.Y.Z
   git push origin vX.Y.Z
   ```

5. The workflow runs the full CI job, then refuses to publish unless:
   - the tagged commit is on `main` (the job checks out the full history to test this);
   - the tag is `vX.Y.Z` and equals the `package.json` version;
   - `CHANGELOG.md` has a `## [X.Y.Z] - YYYY-MM-DD` heading with at least one entry;
   - `pnpm pack` lists nothing outside `dist/`, `package.json`, `README.md`, `LICENSE` and
     `CHANGELOG.md`.

   It then runs `npm stage publish --provenance --access public` through the trusted publisher.
   The version is staged, not yet installable.

6. The maintainer reviews and approves the staged version with 2FA, on npmjs.com under the
   package's Staged Packages tab or from the CLI (npm 11.15.0 or later):

   ```sh
   npm stage list @edgesweden/consent
   npm stage view <stage-id>
   npm stage download <stage-id>   # optional: inspect the tarball
   npm stage approve <stage-id>
   ```

   If anything looks wrong, reject it with `npm stage reject <stage-id>` and fix forward.

Fix forward, always. A failed or wrong release is corrected by a new patch version through a new
pull request and a new tag. A published version is never unpublished, and a pushed tag is never
moved or deleted, also when the workflow failed before staging. A transient failure, such as a
registry outage, is handled by re-running the failed workflow run on the same tag.

## Trusted publisher

The workflow authenticates to npm through OIDC, so the package needs a trusted publisher that
names this workflow. A maintainer with 2FA sets it up on npmjs.com under the package's Settings:

1. Add a trusted publisher: GitHub Actions, organisation `EdgeSweden`, repository `theconsent`,
   workflow `release.yml`, no environment.
2. Allow staged publishing only: leave "Allow npm publish" and "Allow npm dist-tag" unticked, so
   the workflow can stage but never publish directly.
3. Under Publishing access, select "Require two-factor authentication and disallow tokens".

npm expires a trusted-publisher configuration that has not been used 48 hours after it was
created; it becomes permanent with its first successful use. Create it only when the release tag
is ready to push, and push the tag in the same sitting. If it expires, create it again.
