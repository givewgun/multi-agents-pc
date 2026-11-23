# Releasing & Publishing

Releases are automated via [.github/workflows/release.yml](../.github/workflows/release.yml).

## One-time setup (before your very first release)

1. **Make the GitHub repo public** (required for public npm provenance and public installs):
   GitHub → **Settings → General → Danger Zone → Change visibility → Public**.
2. **Connect npm publishing (pick one):**
   - **Recommended — npm Trusted Publishing (OIDC, no long-lived tokens):**
     1. Publish `0.2.0` once manually (`npm login && npm publish --access public`) *or* configure Trusted Publishing on [npmjs.com](https://www.npmjs.com/) under package **Settings → Publishing access → GitHub Actions**:
        - Repository: `givewgun/multi-agents-pc`
        - Workflow filename: `release.yml`
        - Environment: *(leave blank)*
     2. Done — `release.yml` already has `permissions: id-token: write` and runs `npm publish --provenance --access public`.
   - **Alternative — classic `NPM_TOKEN` secret:**
     Add an npm automation token as a GitHub repo secret named `NPM_TOKEN` (**Settings → Secrets and variables → Actions**). `release.yml` automatically uses it if present.

## Cutting a release (every time)

1. Ensure `main` is clean and `CHANGELOG.md` has a section for the new version.
2. Bump the version, tag, and push:

```bash
npm version patch   # or minor / major
git push origin main --follow-tags
```

GitHub Actions (`release.yml`) will automatically:
1. Run `npm test` and verify the packed `.tgz` installs cleanly and passes CLI smoke checks.
2. Verify the git tag (`vX.Y.Z`) matches `package.json`.
3. Create a GitHub Release with auto-generated release notes and attach the `.tgz` tarball.
4. Publish `tandem-agents@X.Y.Z` to npm with provenance attestation.

> Tip: You can test the workflow without publishing by running **Actions → Release → Run workflow** with `dry_run: true`.
