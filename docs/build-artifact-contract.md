# Build Artifact Contract (v1)

This document defines the payload and artifact layout expected between the Rails app and build service.

## Builder Response Contract

The builder returns JSON with build status and manifest data.

```json
{
  "status": "succeeded",
  "build_id": "bld_01HXYZ",
  "manifest": {
    "version": 1,
    "build_id": "bld_01HXYZ",
    "generated_at": "2026-05-15T00:00:00Z",
    "entrypoint": "index.html",
    "files": [
      { "path": "index.html", "content_type": "text/html" },
      { "path": "assets/site.css", "content_type": "text/css" },
      { "path": "assets/site.js", "content_type": "application/javascript" }
    ]
  }
}
```

## Build Status State Machine

- pending -> queued
- queued -> running | failed
- running -> succeeded | failed
- succeeded -> queued
- failed -> queued

## Object Key Layout (DigitalOcean Spaces)

Artifacts should be stored under a per-project namespace.

- projects/:project_id/builds/:build_id/manifest.json
- projects/:project_id/builds/:build_id/index.html
- projects/:project_id/builds/:build_id/assets/*

## Security Notes

- Rails-to-builder requests are authenticated with a shared token.
- User uploads are scoped to project ownership.
- Public share rendering should use signed or proxy URLs for object access.