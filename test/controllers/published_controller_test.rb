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

    # Published output answers only on the published origin (config.x.published_url_options);
    # on the default www.example.com host these routes do not exist. The cross-origin
    # tests at the bottom flip the host back to prove that.
    host! "pub.example.com"
  end

  def attach_page(build, path, body)
    file = build.build_files.find_or_create_by!(relative_path: path)
    file.blob.attach(io: StringIO.new(body), filename: File.basename(path), content_type: "text/html")
    file
  end

  def publish!(target = @target)
    target.update!(published: true)
  end

  # A published pdf target with one real artifact behind it. `files_public` stands in for
  # PublishBuildFilesJob having run, which it does not in an integration test.
  def published_pdf_build(files_public: true)
    target = projects(:two).targets.create!(name: "Print", kind: "pdf")
    build = target.builds.create!
    file = build.build_files.create!(relative_path: "print.pdf")
    file.blob.attach(io: StringIO.new("%PDF-1.4"), filename: "print.pdf", content_type: "application/pdf")
    build.mark!(:success, entry_path: "print.pdf")
    publish!(target)
    build.update_column(:files_public_at, Time.current) if files_public
    build
  end

  # config.x.cdn_url_options is set in production only, so the CDN branch is unreachable
  # in test without saying so here.
  def with_cdn_url_options(options)
    previous = Rails.application.config.x.cdn_url_options
    Rails.application.config.x.cdn_url_options = options
    yield
  ensure
    Rails.application.config.x.cdn_url_options = previous
  end

  test "anyone can read a published target" do
    publish!

    get published_file_url(@project, @target.slug, "index.html")

    assert_response :success
    assert_match "Chapter One", response.body
  end

  # Built PreTeXt links between pages relatively, so a visitor has to land one level
  # inside the target or every internal link resolves a directory too high. Rails
  # normalizes trailing slashes away in routing, so both bare forms take this path.
  test "both bare forms redirect to the index so relative links resolve" do
    publish!

    [ published_url(@project, @target.slug), "/o/#{@project.id}/#{@target.slug}/" ].each do |bare|
      get bare
      assert_redirected_to "/o/#{@project.id}/#{@target.slug}/index.html"
      assert_response :found, "a 301 would still be followed after unpublishing"
    end
  end

  test "the redirect lands on a page that actually renders" do
    publish!

    get published_url(@project, @target.slug)
    follow_redirect!

    assert_response :success
    assert_match "Chapter One", response.body
  end

  test "an unpublished target is not found rather than forbidden" do
    assert_not @target.published?

    get published_file_url(@project, @target.slug, "index.html")

    assert_response :not_found
  end

  # Whoever follows a link to an unpublished target did nothing wrong, so the answer has to
  # be an explanation and not a Rails error page.
  test "a missing target explains itself instead of erroring" do
    get published_file_url(@project, @target.slug, "index.html")

    assert_response :not_found
    assert_match "not publicly available", response.body
    assert_match "noindex", response.body
  end

  # A published site asks for its own images and stylesheets. Answering a missing one with
  # a whole rendered page is work the browser throws away.
  test "a non-navigation request gets a bare 404" do
    publish!

    get published_file_url(@project, @target.slug, "missing.png"), headers: { "Accept" => "image/png" }

    assert_response :not_found
    assert_empty response.body
  end

  test "unpublishing breaks the link immediately" do
    publish!
    get published_file_url(@project, @target.slug, "index.html")
    assert_response :success

    @target.update!(published: false)

    get published_file_url(@project, @target.slug, "index.html")
    assert_response :not_found
  end

  # The case the whole design exists for: a failed rebuild must not take a live site down.
  test "a failed rebuild leaves the published output serving the last good build" do
    publish!
    @target.builds.create!.mark!(:failed)

    assert_equal :failed, @target.reload.state
    get published_file_url(@project, @target.slug, "index.html")

    assert_response :success
    assert_match "Chapter One", response.body
  end

  test "a successful rebuild moves the published output to the new build" do
    publish!
    newer = @target.builds.create!(created_at: 1.minute.from_now)
    attach_page(newer, "index.html", "<h1>Chapter One, revised</h1>")
    newer.mark!(:success)

    get published_file_url(@project, @target.slug, "index.html")

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

  # A pdf target has no index.html, so the bare URL has to land on the artifact itself.
  test "a single-file output redirects to its artifact, not to an index" do
    target = projects(:two).targets.create!(name: "Print", kind: "pdf")
    build = target.builds.create!
    build.build_files.create!(relative_path: "print.pdf")
    build.mark!(:success, entry_path: "print.pdf")
    target.update!(published: true)

    get published_url(projects(:two), "print")

    assert_redirected_to "/o/#{projects(:two).id}/print/print.pdf"
  end

  # ---- the CDN ----

  test "a public single-file artifact is served from the CDN, not from storage" do
    build = published_pdf_build

    with_cdn_url_options(host: "cdn.example.com", protocol: "https") do
      get published_file_url(projects(:two), "print", "print.pdf")
    end

    assert_redirected_to "https://cdn.example.com/#{build.build_files.sole.blob.key}"
  end

  # The scheme comes from the same config entry as the host. Hard-coding https here would
  # keep working right up until the config said otherwise, and then fail silently.
  test "the CDN redirect uses the configured protocol" do
    build = published_pdf_build

    with_cdn_url_options(host: "cdn.example.com", protocol: "http") do
      get published_file_url(projects(:two), "print", "print.pdf")
    end

    assert_redirected_to "http://cdn.example.com/#{build.build_files.sole.blob.key}"
  end

  # PublishBuildFilesJob flips the objects world-readable in the background, so for a
  # moment after publishing -- or for good, if the storage provider refused -- the CDN URL
  # would 404 at the reader. The signed URL resolves whatever the ACL says, so it is what
  # goes out until the job has said otherwise.
  test "an artifact that is not yet public gets a signed url rather than a broken CDN one" do
    published_pdf_build(files_public: false)

    with_cdn_url_options(host: "cdn.example.com", protocol: "https") do
      get published_file_url(projects(:two), "print", "print.pdf")
    end

    assert_response :redirect
    assert_no_match(/cdn\.example\.com/, response.headers["Location"])
  end

  test "an unbuilt target has nowhere to redirect to" do
    target = projects(:two).targets.create!(name: "Print", kind: "pdf", published: true)

    get published_url(projects(:two), "print")

    assert_response :not_found
  end

  test "an unknown target slug is not found" do
    get published_file_url(@project, "no-such-target", "index.html")
    assert_response :not_found
  end

  test "a path that is not in the build is not found" do
    publish!
    get published_file_url(@project, @target.slug, "secrets.html")
    assert_response :not_found
  end

  # The lookup only ever matches stored relative_paths, so traversal cannot escape --
  # it simply fails to match.
  test "path traversal does not escape the build" do
    publish!
    get "/o/#{@project.id}/#{@target.slug}/..%2F..%2Fconfig/database.yml"
    assert_response :not_found
  end

  # There used to be an owner exception here. It went with the origin split: the session
  # cookie is host-only on the app origin, so on the published origin even the owner is
  # anonymous and the exception could never fire in production -- keeping it would only
  # have made this suite lie (Warden's test mode bypasses cookies). Owners preview
  # through the dashboard's Preview button (build_file_path) instead.
  test "an unpublished output is hidden even from its owner at the public url" do
    sign_in users(:two)
    assert_not @target.published?

    get published_file_url(@project, @target.slug, "index.html")

    assert_response :not_found
  end

  test "a signed-in stranger cannot see an unpublished output" do
    sign_in users(:one)

    get published_file_url(@project, @target.slug, "index.html")

    assert_response :not_found
  end

  # The origin split is the security boundary: published pages carry author JavaScript,
  # so they must never be served by -- and nothing session-bearing must ever answer on --
  # the published origin. See docs/build-targets.md.
  test "the app origin does not serve published output, it bounces to the published origin" do
    publish!
    host! "www.example.com"

    get "/o/#{@project.id}/#{@target.slug}/index.html"

    assert_redirected_to "http://pub.example.com/o/#{@project.id}/#{@target.slug}/index.html"
  end

  test "nothing but published output answers on the published origin" do
    get "/users/sign_in"
    assert_redirected_to "http://example.com/users/sign_in"

    get "/"
    assert_redirected_to "http://example.com/"
  end

  # A stray /o path must dead-end, not bounce between the two origins forever: the
  # app-origin redirect only matches the real route shape, so this 404s on the app side.
  test "a malformed published path does not redirect-loop across origins" do
    get "/o/not-enough-segments"
    follow_redirect!

    assert_response :not_found
  end
end
