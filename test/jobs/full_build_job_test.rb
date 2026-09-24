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
  def stub_submit(&block)
    response = Net::HTTPOK.new("1.1", "200", "")
    response.instance_variable_set(:@read, true)
    response.define_singleton_method(:body) { { status_url: "https://build.example.com/s/1" }.to_json }
    Net::HTTP.stub(:start, ->(*_args, **_kw) { response }, &block)
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
    @project.divisions.find_by(is_root: true).update!(is_root: false)
    @project.divisions.create!(id: ROOT_ID, ref: "placeholder", source: "<book/>",
                               source_format: "pretext", is_root: true)
    ProjectDoc.seed(@project, collab_fixture("projection_state"))

    seen = {}
    stub_submit do
      SourceAssembler.stub(:new, capturing_assembler(seen)) { FullBuildJob.perform_now(@build) }
    end

    assert_equal "Projected Title", seen[:title],
      "the archive was built from the project as it stood before the projection ran"
    assert_includes seen[:root_source], "<title>Projected Book</title>",
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
