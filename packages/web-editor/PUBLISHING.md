# Publishing Guide for @pretextbook/web-editor

This guide explains how to publish the package to npm.

## Prerequisites

1. An npm account ([create one here](https://www.npmjs.com/signup))
2. Local npm authentication configured

### Authentication Setup

If you haven't already, log in to npm:

```bash
npm login
```

You'll be prompted to enter:

- Username
- Password
- Email

## Before Publishing

Make sure to:

1. **Update the version** in `package.json`:

   ```bash
   npm version patch  # for bug fixes (0.0.1 -> 0.0.2)
   npm version minor  # for new features (0.0.1 -> 0.1.0)
   npm version major  # for breaking changes (0.0.1 -> 1.0.0)
   ```

2. **Build the package**:

   ```bash
   npm run build
   ```

3. **Test the build locally** (optional but recommended):

   ```bash
   npm pack
   ```

   This creates a `.tgz` file you can test before publishing.

4. **Commit changes** to git:
   ```bash
   git add package.json package-lock.json
   git commit -m "Bump version to X.X.X"
   git tag vX.X.X
   git push origin main --tags
   ```

## Publishing to npm

```bash
npm publish
```

The package will be published with:

- Name: `@pretextbook/web-editor`
- Scope: `@pretextbook` (requires the org to exist on npm)

If the `@pretextbook` scope doesn't exist yet, you'll need to create it:

```bash
npm publish --access public
```

## After Publishing

1. Check npm registry:

   ```bash
   npm view @pretextbook/web-editor
   ```

2. Share the package info with users and provide installation instructions

## Scoped Package Notes

Since this is a scoped package (`@pretextbook/web-editor`), users will install it with:

```bash
npm install @pretextbook/web-editor
```

And import it as:

```tsx
import { Editors } from "@pretextbook/web-editor";
```

## Public Scope

By default, scoped packages are private. To make it public (which you've done by setting `"private": false`), use:

```bash
npm publish --access public
```

## Troubleshooting

**Error: "You must be logged in"**

- Run `npm login` to authenticate

**Error: "409 Conflict"**

- The version already exists. Use `npm version patch` to bump it.

**Error: "Unlinked repository"**

- Your git history might be disconnected. This is just a warning and can be ignored.

## Update Package Details

To update package metadata after publishing (like the description or homepage), just edit `package.json` and republish with a new version.
