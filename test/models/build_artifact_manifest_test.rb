require "test_helper"

class BuildArtifactManifestTest < ActiveSupport::TestCase
  test "valid manifest passes" do
    manifest = BuildArtifactManifest.new(
      {
        "version" => 1,
        "build_id" => "build-123",
        "generated_at" => "2026-05-15T00:00:00Z",
        "entrypoint" => "index.html",
        "files" => [
          { "path" => "index.html", "content_type" => "text/html" },
          { "path" => "assets/site.css", "content_type" => "text/css" }
        ]
      }
    )

    assert_predicate manifest, :valid?
    assert_empty manifest.errors
  end

  test "missing required keys is invalid" do
    manifest = BuildArtifactManifest.new(
      {
        "version" => 1,
        "files" => []
      }
    )

    assert_not_predicate manifest, :valid?
    assert_includes manifest.errors.join(" "), "missing keys"
  end

  test "entrypoint must exist in files" do
    manifest = BuildArtifactManifest.new(
      {
        "version" => 1,
        "build_id" => "build-123",
        "generated_at" => "2026-05-15T00:00:00Z",
        "entrypoint" => "missing.html",
        "files" => [
          { "path" => "index.html", "content_type" => "text/html" }
        ]
      }
    )

    assert_not_predicate manifest, :valid?
    assert_includes manifest.errors, "entrypoint must exist in files"
  end
end