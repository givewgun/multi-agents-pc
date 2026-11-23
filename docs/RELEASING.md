# Releasing & Publishing

Releases are automated via [.github/workflows/release.yml](../.github/workflows/release.yml).

## One-time setup (first release: `v0.2.0`)

1. **Make the GitHub repo public** (required for npm provenance and public installs):
   GitHub → **Settings → General → Danger Zone → Change visibility → Public**.
2. **Bootstrap the package on npm (pick one):**
   - **Option A — publish `0.2.0` once via GitHub Actions with `NPM_TOKEN`:**
     Add an npm automation token as a repository secret named `NPM_TOKEN` (**Settings → Secrets and variables → Actions**), then tag and push `v0.2.0` (step 3 below).
   - **Option B — publish `0.2.0` once locally:**
     Run `npm login && npm publish --access public`, then push the `v0.2.0` tag or create the GitHub Release manually.
3. **Tag and push `v0.2.0`** (`package.json` is already at `0.2.0`, so don't run `npm version` for this first release):
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. **Switch to npm Trusted Publishing (OIDC, no long-lived tokens) after the first publish:**
   Once `tandem-agents` exists on [npmjs.com](https://www.npmjs.com/), go to package **Settings → Publishing access → GitHub Actions**:
   - Repository: `givewgun/multi-agents-pc`
   - Workflow filename: `release.yml`
   - Environment: *(leave blank)*

   Then delete the `NPM_TOKEN` secret from GitHub. `release.yml` already has `permissions: id-token: write` and publishes via OIDC automatically.

## Cutting subsequent releases (`0.2.1`, `0.3.0`, …)

1. Ensure `main` is clean and `CHANGELOG.md` has a section for the new version.
2. Bump the version, tag, and push:

```bash
npm version patch   # or minor / major / prerelease --preid=rc
git push origin main --follow-tags
```

GitHub Actions (`release.yml`) will automatically:
1. Run `npm test`, verify the git tag matches `package.json`, and run `scripts/verify-pack.mjs` to test installing the packed `.tgz`.
2. Publish that exact verified `.tgz` to npm with `--provenance --access public` (automatically adding `--tag next` for prerelease versions like `0.3.0-rc.1`).
3. Create a GitHub Release with auto-generated release notes and attach the `.tgz` tarball (marked `--prerelease` when applicable).

> Tip: You can test the verification and packing step without publishing by running **Actions → Release → Run workflow** with `dry_run: true`.
