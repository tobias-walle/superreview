# Releasing

Releases run from `.github/workflows/release.yml` after each push to `main`. The workflow uses semantic-release and npm Trusted Publishing. It does not use an npm token.

The repository variable `NPM_PUBLISH_ENABLED` is a bootstrap safety switch. The release job runs only when its value is `true`.

## One-time bootstrap

1. Push `main` while `NPM_PUBLISH_ENABLED` is unset.
2. From a clean checkout of the release commit, run `pnpm install --frozen-lockfile`, `pnpm check -- --force`, and `pnpm build`.
3. Run `npm login`, then publish the initial package with `cd dist-cli && npm publish --access public`.
4. Tag the same commit with `v0.2.1` and push the tag.
5. Configure `release.yml` as the npm trusted publisher. Bind it to the `npm-production` GitHub environment and allow `npm publish`.
6. Configure the `npm-production` environment and its protection rules in GitHub.
7. Set the GitHub Actions repository variable `NPM_PUBLISH_ENABLED` to `true`.

## Normal releases

Use Conventional Commit messages on commits merged to `main`:

- `fix:` and `perf:` publish a patch release.
- `feat:` publishes a minor release.
- `type!:` or a `BREAKING CHANGE:` footer publishes a major release.
- Other commit types do not publish a release by default.

semantic-release creates the version tag, GitHub release notes, npm package, and provenance attestation. Package versions are derived from Git tags and are not committed back to `package.json`.
