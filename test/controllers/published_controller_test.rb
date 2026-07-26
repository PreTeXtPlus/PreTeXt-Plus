require "test_helper"

# The public face of a built target. These are the tests that decide whether "published"
# actually means anything, so they lean on the cases where it could silently leak:
# unpublished targets, superseded builds, and failed rebuilds over a live site.
class PublishedControllerTest < ActionDispatch::IntegrationTest
  setup do
    @project = projects(:two)
    @target = targets(:two_web)
    @build = builds(:two) # the target's current_build
    attach_page(@build, "index.html", "<h1>Chapter One</h1>")
    Rails.cache.clear
  end

  def attach_page(build, path, body)
    file = build.build_files.find_or_create_by!(relative_path: path)
    file.blob.attach(io: StringIO.new(body), filename: File.basename(path), content_type: "text/html")
    file
  end

  def publish!(target = @target)
    target.update!(published: true)
  end

  test "anyone can read a published target" do
    publish!

    get published_file_url(@project, @target.name, "index.html")

    assert_response :success
    assert_match "Chapter One", response.body
  end

  # Built PreTeXt links between pages relatively, so a visitor has to land one level
  # inside the target or every internal link resolves a directory too high. Rails
  # normalizes trailing slashes away in routing, so both bare forms take this path.
  test "both bare forms redirect to the index so relative links resolve" do
    publish!

    [ published_url(@project, @target.name), "/o/#{@project.id}/#{@target.name}/" ].each do |bare|
      get bare
      assert_redirected_to "/o/#{@project.id}/#{@target.name}/index.html"
      assert_response :found, "a 301 would still be followed after unpublishing"
    end
  end

  test "the redirect lands on a page that actually renders" do
    publish!

    get published_url(@project, @target.name)
    follow_redirect!

    assert_response :success
    assert_match "Chapter One", response.body
  end

  test "an unpublished target is not found rather than forbidden" do
    assert_not @target.published?

    get published_file_url(@project, @target.name, "index.html")

    assert_response :not_found
  end

  test "unpublishing breaks the link immediately" do
    publish!
    get published_file_url(@project, @target.name, "index.html")
    assert_response :success

    @target.update!(published: false)

    get published_file_url(@project, @target.name, "index.html")
    assert_response :not_found
  end

  # The case the whole design exists for: a failed rebuild must not take a live site down.
  test "a failed rebuild leaves the published output serving the last good build" do
    publish!
    @target.builds.create!.mark!(:failed)

    assert_equal :failed, @target.reload.state
    get published_file_url(@project, @target.name, "index.html")

    assert_response :success
    assert_match "Chapter One", response.body
  end

  test "a successful rebuild moves the published output to the new build" do
    publish!
    newer = @target.builds.create!(created_at: 1.minute.from_now)
    attach_page(newer, "index.html", "<h1>Chapter One, revised</h1>")
    newer.mark!(:success)

    get published_file_url(@project, @target.name, "index.html")

    assert_response :success
    assert_match "revised", response.body
  end

  # Publishing exposes exactly one build, not the target's whole history.
  test "a superseded build is not readable by a stranger" do
    publish!
    superseded = @build
    newer = @target.builds.create!(created_at: 1.minute.from_now)
    attach_page(newer, "index.html", "<h1>Newer</h1>")
    newer.mark!(:success)

    # Direct build addressing requires a login at all, and the ability rule only covers
    # the target's *current* build.
    assert_not Ability.new(nil).can?(:read, superseded.reload)
    assert Ability.new(nil).can?(:read, newer)
  end

  test "an unknown target name is not found" do
    get published_file_url(@project, "no-such-target", "index.html")
    assert_response :not_found
  end

  test "a path that is not in the build is not found" do
    publish!
    get published_file_url(@project, @target.name, "secrets.html")
    assert_response :not_found
  end

  # The lookup only ever matches stored relative_paths, so traversal cannot escape --
  # it simply fails to match.
  test "path traversal does not escape the build" do
    publish!
    get "/o/#{@project.id}/#{@target.name}/..%2F..%2Fconfig/database.yml"
    assert_response :not_found
  end

  test "an owner may preview their own unpublished output at its public url" do
    sign_in users(:two)
    assert_not @target.published?

    get published_file_url(@project, @target.name, "index.html")

    assert_response :success
  end

  test "a signed-in stranger still cannot see an unpublished output" do
    sign_in users(:one)

    get published_file_url(@project, @target.name, "index.html")

    assert_response :not_found
  end
end
