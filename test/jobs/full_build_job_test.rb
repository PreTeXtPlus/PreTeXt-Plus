require "test_helper"

# The point of this job's ordering: the rows a build's source is assembled from
# are written by the job itself, immediately before they are read. "The build
# consumed stale source" was a timing race; these are the tests that it is not
# one any more.
class FullBuildJobTest < ActiveJob::TestCase
  ROOT_ID = "33333333-3333-4333-8333-333333333333".freeze

  setup do
    @build = builds(:one)
    @project = @build.project
  end

  def collab_fixture(name)
    File.binread(Rails.root.join("test/fixtures/files/collab/#{name}.bin"))
  end

  # A successful submit, so the job runs to the end rather than stopping at the
  # first thing it cannot reach.
  #
  # Given a `wire`, the request is also written into it as it would go out on the
  # socket. `set_form` in multipart mode encodes its fields only while writing, so
  # there is no body to read off the request object itself.
  def stub_submit(wire: nil, &block)
    response = Net::HTTPOK.new("1.1", "200", "")
    response.instance_variable_set(:@read, true)
    response.define_singleton_method(:body) { { status_url: "https://build.example.com/s/1" }.to_json }
    http = Object.new
    http.define_singleton_method(:request) do |req|
      req.exec(wire, "1.1", req.path) if wire
      response
    end
    Net::HTTP.stub(:start, proc { |*_args, **_kw, &http_block| http_block.call(http) }, &block)
  end

  # The multipart value of one field in a request written by stub_submit. Read as
  # bytes, because the archive part of the same body is a zip.
  def form_field(wire, name)
    wire.string.b[/name="#{Regexp.escape(name)}"\r\n\r\n(.*?)\r\n/n, 1]&.force_encoding(Encoding::UTF_8)
  end

  # Hand back a project-shaped double that records which project it was built
  # for and what that project's rows said at the moment it was asked -- which is
  # the ordering question, not a detail of the archive.
  def capturing_assembler(seen)
    lambda do |project|
      seen[:title] = project.title
      seen[:root_source] = project.divisions.find_by(is_root: true)&.source
      Struct.new(:call).new("<pretext><article/></pretext>")
    end
  end

  test "the collaborative document is projected into the rows before they are read" do
    # Deleted outright: the model refuses to demote or destroy a root.
    @project.divisions.where(is_root: true).delete_all
    @project.divisions.create!(id: ROOT_ID, ref: "placeholder", source: "<p/>",
                               source_format: "pretext", is_root: true, division_type: "book")
    ProjectDoc.seed(@project, collab_fixture("projection_state"))

    seen = {}
    stub_submit do
      SourceAssembler.stub(:new, capturing_assembler(seen)) { FullBuildJob.perform_now(@build) }
    end

    assert_equal "Projected Title", seen[:title],
      "the archive was built from the project as it stood before the projection ran"
    assert_equal "<p>The projected book.</p>", seen[:root_source],
      "the source assembled for this build was not the source in the document"
    assert_equal "sent_to_server", @build.reload.status
  end

  # Most projects have no live document -- never opened collaboratively, or
  # compacted away since. Their rows are the only truth there is, and the job
  # must build from them rather than refuse to.
  test "a project with no document builds from its rows unchanged" do
    title = @project.title
    seen = {}

    stub_submit do
      SourceAssembler.stub(:new, capturing_assembler(seen)) { FullBuildJob.perform_now(@build) }
    end

    assert_equal title, seen[:title]
    assert_equal "sent_to_server", @build.reload.status
  end

  # The build server keeps a cache of generated assets for each project_id it is
  # sent. Without the field every build regenerates every figure; with the wrong
  # id a build would read and write another project's cache.
  test "the submission names the project whose asset cache the server should use" do
    wire = StringIO.new

    stub_submit(wire: wire) do
      SourceAssembler.stub(:new, capturing_assembler({})) { FullBuildJob.perform_now(@build) }
    end

    assert_equal @project.id, form_field(wire, "project_id")
    assert_equal @build.target.slug, form_field(wire, "target")
    assert_equal "sent_to_server", @build.reload.status
  end

  # There is no stored source to fall back on, so a build that cannot assemble
  # its own is a failed build, not one that ships whatever was lying around.
  test "a build whose source will not assemble fails rather than submitting" do
    raiser = Struct.new(:noop) do
      def call = raise(SourceAssembler::AssemblyError, "no assembler")
    end

    submitted = false
    Net::HTTP.stub(:start, ->(*_a, **_k) { submitted = true }) do
      SourceAssembler.stub(:new, ->(_p) { raiser.new }) do
        assert_raises(SourceAssembler::AssemblyError) { FullBuildJob.perform_now(@build) }
      end
    end

    assert_not submitted, "a build with no assembled source must not reach the build server"
    assert_equal "failed", @build.reload.status
  end
end
