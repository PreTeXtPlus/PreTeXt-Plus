#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.local.yml"

echo "Starting local dependency stack"
docker compose -f "$COMPOSE_FILE" up -d --build

cleanup() {
  echo "Stopping local dependency stack"
  docker compose -f "$COMPOSE_FILE" down
}
trap cleanup EXIT

echo "Waiting for local builder"
for _ in {1..20}; do
  if curl -fsS "http://localhost:4010/health" >/dev/null; then
    break
  fi
  sleep 1
done

echo "Waiting for local S3 emulator"
for _ in {1..20}; do
  if curl -fsS "http://localhost:9000/minio/health/live" >/dev/null; then
    break
  fi
  sleep 1
done

echo "Running build contract smoke call"
response="$(curl -fsS -X POST "http://localhost:4010/build" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "source=<pretext><article><title>Smoke</title></article></pretext>" \
  --data-urlencode "title=Smoke" \
  --data-urlencode "token=local-build-token")"

echo "$response" | grep -q '"entrypoint": "index.html"'
echo "$response" | grep -q '"assets/site.css"'
echo "$response" | grep -q '"assets/site.js"'
echo "$response" | grep -q '"inline_files"'

echo "Local dependency stack smoke test passed"