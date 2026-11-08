require "test_helper"

# The console procedure from both November 2026 incidents, as a service. Every
# test is a project in one of the states the procedure had to handle.
class ProjectDocRepairTest < ActiveSupport::TestCase
  ASSET_ID = "88888888-8888-4888-8888-888888888888".freeze
  KEEPER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee0".freeze
  SPACED_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1".freeze
  HEALTHY_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd0".freeze

  def fixture(name)
    File.binread(Rails.root.join("test/fixtures/files/collab/#{name}.bin"))
  end

  setup do
    @project = projects(:one)
    @repair = ProjectDocRepair.new(@project)
  end

  # The production shapes: an asset emptied to `{source: ""}`, a division with
  # a spaced xml:id, duplicate refs. The rows the asset and the keeper have.
  def seed_stuck!
    @project.assets.create!(id: ASSET_ID, ref: "stale-plot", kind: :authored_asset,
                            title: "Stale", source: "<latex-image>s</latex-image>", short_description: "kept")
    @project.divisions.create!(id: KEEPER_ID, ref: "kept", source: "<p>row</p>", source_format: "pretext")
    ProjectDoc.seed(@project, fixture("projection_issues_state"))
  end

  # Records the cable disconnects the repair asks for, instead of sending them.
  def capturing_disconnects
    disconnected = []
    remote = Object.new
    remote.define_singleton_method(:where) do |current_user:|
      Struct.new(:user) { def disconnect(reconnect:) = @disconnected << user }.new(current_user).tap do |conn|
        conn.instance_variable_set(:@disconnected, disconnected)
      end
    end
    ActionCable.server.stub(:remote_connections, remote) { yield }
    disconnected
  end

  test "a project with no document has nothing to report or repair" do
    assert_nil @repair.report
    assert_match(/no collaborative document/, @repair.render(nil))
    assert_raises(ProjectDocRepair::Abort) { @repair.apply! }
  end

  test "a healthy, projected document reports no issues, no differing rows and nothing to drop" do
    ProjectDoc.seed(@project, fixture("projection_state"))
    ProjectDocProjection.new(@project).apply!

    report = @repair.report

    assert_equal [], report[:issues]
    assert_equal [], report[:differing_rows]
    assert_equal [], report[:dropped_entries]
    assert_equal [ users(:one).email, users(:two).email ].sort, report[:users].map { |u| u[:email] }.sort,
      "the owner and the accepted collaborator; a pending invite has nobody to disconnect"
  end

  test "an unprojected document shows the rows that lag it" do
    ProjectDoc.seed(@project, fixture("projection_state"))

    report = @repair.report

    fields = report[:differing_rows].map { |d| [ d[:kind], d[:field] ] }
    assert_includes fields, [ "project", "title" ]
    assert_includes fields, [ "division", "row" ], "a division the document has and the rows do not yet"
  end

  test "a stuck document reports its issues and the full entry of every record the reset will drop" do
    seed_stuck!

    report = @repair.report

    assert_includes report[:issues].map { |i| i["id"] }, SPACED_ID
    dropped = report[:dropped_entries].index_by { |e| e[:id] }
    assert_includes dropped.keys, SPACED_ID
    assert_includes dropped.keys, ASSET_ID
    assert_equal "sec-chapter 1 ", dropped[SPACED_ID][:entry]["xmlId"]
    assert dropped[SPACED_ID][:entry].key?("source"), "the record's text is in the report, so it can be copied out"
    assert_not_includes dropped.keys, HEALTHY_ID, "a record that will be projected is not dropped"

    text = @repair.render(report)
    assert_match(/sec-chapter 1 /, text)
    assert_match(/Entries the reset will drop \(#{dropped.size}\)/, text)
  end

  test "apply! disconnects everyone, projects, resets the document, and clears the issues" do
    seed_stuck!
    ProjectDocProjection.new(@project).apply!
    assert @project.reload.projection_issues.any?

    disconnected = capturing_disconnects { @repair.apply! }

    assert_not ProjectDoc.seeded?(@project), "the document is gone; the next tab reseeds it from the rows"
    assert_equal [], @project.reload.projection_issues
    assert_equal "healthy-section", Content.find(HEALTHY_ID).ref, "the good records reached the rows"
    assert_equal "Stale", Content.find(ASSET_ID).title, "the emptied asset's row kept its fields"
    assert_not Content.exists?(SPACED_ID), "the malformed entry never became a row, and is now gone with the document"
    # Twice: before projecting, and again after the reset in case anyone rejoined.
    assert_equal 2, disconnected.count(users(:one))
    assert_equal 2, disconnected.count(users(:two))
  end

  test "apply! stops before the reset when the rows cannot be made to match the document" do
    ProjectDoc.seed(@project, fixture("projection_state"))
    # A projection that writes nothing, so the rows still lag the document. It
    # previews through the real class, captured before `new` is stubbed.
    real_new = ProjectDocProjection.method(:new)
    inert = Struct.new(:project) do
      def apply! = true
    end
    inert.define_method(:preview) { real_new.call(project).preview }

    capturing_disconnects do
      ProjectDocProjection.stub(:new, ->(project) { inert.new(project) }) do
        assert_raises(ProjectDocRepair::Abort) { @repair.apply! }
      end
    end

    assert ProjectDoc.seeded?(@project), "the document must survive an aborted repair"
  end
end
