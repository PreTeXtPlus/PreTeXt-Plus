# Changelog

## 0.8.0

- **Separate an asset's build `source` value from its thumbnail URL.** Added an optional
  `Asset.fileRef` field — the exact string emitted as the `source` attribute of a
  file-backed `<image>` element (a bare external-asset filename like
  `"euler-painting.png"`, which the PreTeXt build server resolves under `external/`).
  `Asset.url` is now documented as the asset-manager thumbnail only (`<img src={url}>`).
  All `<image source>` emit sites now use `fileRef ?? url`, so the previous behavior is
  preserved for hosts that only set `url`.
