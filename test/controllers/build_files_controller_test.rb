require "test_helper"

# Owner-facing access to a build's output. The interesting case is the one the dashboard
# relies on: a single-file output has to be downloadable *as itself*, since a PDF or a
# SCORM package is the artifact rather than a directory to browse.
class BuildFilesControllerTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:two)
    @build = builds(:two)
    sign_in @user
    Rails.cache.clear
  end

  def attach(path, body, content_type)
    file = @build.build_files.find_or_create_by!(relative_path: path)
    file.blob.attach(io: StringIO.new(body), filename: File.basename(path), content_type: content_type)
    file
  end

  test "html is served inline so a site can be browsed" do
    attach("index.html", "<h1>Chapter One</h1>", "text/html")

    get build_file_url(@build, "index.html")

    assert_response :success
    assert_match "Chapter One", response.body
  end

  # What the dashboard's "Download" links to for anything that is not a site. Routed
  # through here rather than at the blob so rendering a row costs no extra query.
  test "an explicit attachment disposition hands over the file itself" do
    attach("print.pdf", "%PDF-1.4", "application/pdf")

    get build_file_url(@build, "print.pdf", disposition: "attachment")

    assert_response :redirect
    assert_match(/disposition=attachment/, response.location)
  end

  # An html artifact -- a reveal.js deck, or a page inside a package -- must still
  # download when asked, rather than taking the inline branch.
  test "attachment wins over the inline path for html" do
    attach("deck.html", "<h1>Slides</h1>", "text/html")

    get build_file_url(@build, "deck.html", disposition: "attachment")

    assert_response :redirect
    assert_match(/disposition=attachment/, response.location)
  end

  # The parameter selects between two fixed behaviours and is never passed through, so it
  # cannot be used to talk the app into an unexpected content type or disposition.
  test "an unrecognized disposition falls back to how the file is normally served" do
    attach("index.html", "<h1>Chapter One</h1>", "text/html")

    get build_file_url(@build, "index.html", disposition: "inline; filename=evil")

    assert_response :success
    assert_match "Chapter One", response.body
  end

  test "a build's files stay login-only even when the target is published" do
    attach("index.html", "<h1>Chapter One</h1>", "text/html")
    targets(:two_web).update!(published: true)
    sign_out @user

    get build_file_url(@build, "index.html")

    assert_response :redirect
    assert_no_match "Chapter One", response.body
  end
end
