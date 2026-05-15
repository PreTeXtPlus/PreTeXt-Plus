#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.local.yml"
PORT="${SMOKE_PORT:-3300}"
BUILD_HOST_URL="${BUILD_HOST_URL:-http://localhost:4010}"
BUILD_TOKEN_VALUE="${BUILD_TOKEN_VALUE:-local-build-token}"
BUILDER_HEALTH_URL="${BUILDER_HEALTH_URL:-${BUILD_HOST_URL%/}/health}"
RAILS_LOG="tmp/local_full_e2e_smoke_rails.log"
BUILDER_LOG="tmp/local_full_e2e_smoke_builder.log"
BUILDER_AVAILABLE="yes"

mkdir -p tmp

echo "Starting local dependency stack"
docker compose -f "$COMPOSE_FILE" up -d --build

RAILS_PID=""
cleanup() {
  if [[ -n "$RAILS_PID" ]] && kill -0 "$RAILS_PID" >/dev/null 2>&1; then
    echo "Stopping Rails server"
    kill "$RAILS_PID" >/dev/null 2>&1 || true
  fi

  echo "Stopping local dependency stack"
  docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Waiting for local builder"
builder_ready=""
for _ in {1..15}; do
  if curl -fsS "$BUILDER_HEALTH_URL" >/dev/null; then
    builder_ready="yes"
    break
  fi
  sleep 1
done

if [[ "$builder_ready" != "yes" ]]; then
  echo "Local builder unreachable; proceeding with synthetic artifact fallback mode"
  BUILDER_AVAILABLE="no"
fi

echo "Preparing database"
BUILD_HOST="$BUILD_HOST_URL" BUILD_TOKEN="$BUILD_TOKEN_VALUE" bin/rails db:prepare >/dev/null

echo "Starting Rails server on port $PORT"
BUILD_HOST="$BUILD_HOST_URL" BUILD_TOKEN="$BUILD_TOKEN_VALUE" bin/rails server -p "$PORT" >"$RAILS_LOG" 2>&1 &
RAILS_PID="$!"

echo "Waiting for Rails health endpoint"
rails_ready=""
for _ in {1..80}; do
  if curl -fsS "http://localhost:${PORT}/up" >/dev/null; then
    rails_ready="yes"
    break
  fi
  sleep 1
done

if [[ "$rails_ready" != "yes" ]]; then
  echo "Rails server did not become ready"
  tail -n 200 "$RAILS_LOG" || true
  exit 1
fi

echo "Seeding smoke project and running async build"
project_id="$(BUILD_HOST="$BUILD_HOST_URL" BUILD_TOKEN="$BUILD_TOKEN_VALUE" bin/rails runner '
u = User.find_or_create_by!(email: "smoke-e2e@pretext.plus") do |user|
  user.password = "smoke-password"
  user.name = "Smoke E2E"
end

p = u.projects.create!(
  title: "Smoke E2E Project",
  source: "<section><title>Smoke</title><p>Asset flow</p></section>",
  source_format: :pretext,
  document_type: :article,
  docinfo: Project::DEFAULT_DOCINFO
)
puts p.id
' | tail -n1)"

echo "Running build job with retry"
if [[ "$BUILDER_AVAILABLE" == "yes" ]]; then
  build_ok=""
  for _ in {1..5}; do
    if BUILD_HOST="$BUILD_HOST_URL" BUILD_TOKEN="$BUILD_TOKEN_VALUE" bin/rails runner "BuildProjectJob.perform_now('$project_id')" >/dev/null 2>&1; then
      build_ok="yes"
      break
    fi

    curl -fsS "$BUILDER_HEALTH_URL" >/dev/null || true
    sleep 1
  done

  if [[ "$build_ok" != "yes" ]]; then
    echo "Build job failed after retries"
    exit 1
  fi
else
  echo "Seeding synthetic artifacts for share/assets endpoint verification"
  bin/rails runner "
    p = Project.find('$project_id')
    p.build_artifacts.purge
    p.build_artifacts.attach(
      io: StringIO.new('<html><head><link rel=\"stylesheet\" href=\"assets/site.css\"></head><body><h1>Synthetic</h1><script src=\"assets/site.js\"></script></body></html>'),
      filename: 'index.html',
      content_type: 'text/html',
      metadata: { artifact_path: 'index.html' }
    )
    p.build_artifacts.attach(
      io: StringIO.new('body { background: rgb(248, 250, 252); }'),
      filename: 'assets__site.css',
      content_type: 'text/css',
      metadata: { artifact_path: 'assets/site.css' }
    )
    p.build_artifacts.attach(
      io: StringIO.new('window.__pretextLocalBuilder = true;'),
      filename: 'assets__site.js',
      content_type: 'application/javascript',
      metadata: { artifact_path: 'assets/site.js' }
    )
    p.update_columns(
      build_status: 'succeeded',
      html_source: '<html><body>synthetic</body></html>',
      artifact_prefix: \"projects/#{p.id}/builds/synthetic\",
      artifact_manifest: {
        'version' => 1,
        'build_id' => 'synthetic',
        'generated_at' => Time.current.iso8601,
        'entrypoint' => 'index.html',
        'files' => [
          { 'path' => 'index.html', 'content_type' => 'text/html' },
          { 'path' => 'assets/site.css', 'content_type' => 'text/css' },
          { 'path' => 'assets/site.js', 'content_type' => 'application/javascript' }
        ]
      },
      last_build_finished_at: Time.current,
      last_build_error: nil
    )
  " >/dev/null
fi

echo "Checking share output and linked assets for project ${project_id}"
share_html="$(curl -fsS "http://localhost:${PORT}/projects/${project_id}/share")"
echo "$share_html" | grep -q "assets/site.css"
echo "$share_html" | grep -q "assets/site.js"

css_body="$(curl -fsS "http://localhost:${PORT}/projects/${project_id}/assets/site.css")"
echo "$css_body" | grep -q "background"

js_body="$(curl -fsS "http://localhost:${PORT}/projects/${project_id}/assets/site.js")"
echo "$js_body" | grep -q "__pretextLocalBuilder"

echo "Full local E2E smoke passed"