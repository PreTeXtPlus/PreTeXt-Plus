require "test_helper"

class ProjectTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper
  test "enqueue_html_source_job writes placeholder to html_source immediately" do
    project = projects(:one)
    project.enqueue_html_source_job
    assert_equal Project::ENQUEUE_SOURCE_PLACEHOLDER, project.reload.html_source
  end

  test "enqueue_html_source_job enqueues SetHtmlSourceJob" do
    project = projects(:one)
    assert_enqueued_with(job: SetHtmlSourceJob, args: [ project ]) do
      project.enqueue_html_source_job
    end
  end

  test "belongs to user" do
    project = projects(:one)
    assert_equal users(:one), project.user
  end

  test "visibility defaults to private" do
    project = projects(:one)
    assert project.private_visibility?
  end

  test "publicly_listed scope returns only public-visibility projects" do
    assert_includes Project.publicly_listed, projects(:public_project)
    assert_not_includes Project.publicly_listed, projects(:one)
  end

  test "an existing root division's source can be updated without resending its ref" do
    project = projects(:one)
    division = project.root_division
    stub_build_server do
      project.update!(divisions_attributes: [ { id: division.id, source: "<section><title>Edited</title></section>" } ])
    end
    assert_equal "<section><title>Edited</title></section>", division.reload.source
  end

  test "renaming a division's ref keeps its UUID stable" do
    project = projects(:one)
    division = project.root_division
    original_id = division.id
    stub_build_server do
      project.update!(divisions_attributes: [ { id: original_id, ref: "new-xml-id" } ])
    end
    assert_equal original_id, division.reload.id
    assert_equal "new-xml-id", division.ref
  end

  # ---- source_updated_at ----
  #
  # Regression tests for a confirmed bug: the editor saves through nested
  # divisions_attributes, and because no attribute on the projects row itself changes,
  # Rails never issues an UPDATE on the parent. So `updated_at` reported the last rename
  # rather than the last edit, and build staleness had no timestamp to compare against.

  test "editing a division through nested attributes bumps source_updated_at" do
    project = projects(:one)
    project.update_column(:source_updated_at, 3.days.ago)
    division = project.root_division

    stub_build_server do
      project.update!(divisions_attributes: [ { id: division.id, source: "<section><title>Edited</title></section>" } ])
    end

    assert_operator project.reload.source_updated_at, :>, 1.minute.ago
  end

  test "editing a division also fixes the mis-sorted updated_at" do
    project = projects(:one)
    project.update_column(:updated_at, 3.days.ago)
    division = project.root_division

    stub_build_server do
      project.update!(divisions_attributes: [ { id: division.id, source: "<section><title>Edited</title></section>" } ])
    end

    assert_operator project.reload.updated_at, :>, 1.minute.ago
  end

  test "changing an asset bumps source_updated_at" do
    project = projects(:one)
    project.update_column(:source_updated_at, 3.days.ago)

    assets(:authored_one).update!(source: "<p>new</p>")

    assert_operator project.reload.source_updated_at, :>, 1.minute.ago
  end

  test "changing the docinfo bumps source_updated_at" do
    project = projects(:one)
    project.update_column(:source_updated_at, 3.days.ago)

    project.update!(docinfo: "<docinfo><macros>\\newcommand{\\Z}{\\mathbb Z}</macros></docinfo>")

    assert_operator project.reload.source_updated_at, :>, 1.minute.ago
  end

  # The reason this is a separate column rather than a fix to updated_at: renaming must
  # not mark every built target stale.
  test "renaming a project does not bump source_updated_at" do
    project = projects(:one)
    was = 3.days.ago.change(usec: 0)
    project.update_column(:source_updated_at, was)

    project.update!(title: "A New Title")

    assert_equal was, project.reload.source_updated_at
  end

  # ---- default target ----

  test "a new project is created with a website target" do
    project = Project.create!(user: users(:one), title: "Fresh")

    assert_equal 1, project.targets.count
    target = project.targets.first
    assert_equal "Website", target.name
    assert_equal "website", target.slug
    assert_equal "website", target.kind
  end

  # The trap this guard exists for: Rails does not re-validate children when the parent
  # changes, so without an explicit check on Project a slideshow could become an article
  # while keeping a reveal.js target that can never build again.
  test "document_type cannot change out from under a target that depends on it" do
    project = projects(:slides)
    assert project.targets.any? { |t| t.kind == "revealjs" }

    assert_not project.update(document_type: :article)
    assert_match(/Slides/, project.errors[:document_type].to_sentence)
    assert_equal "slideshow", project.reload.document_type
  end

  test "document_type may change once nothing depends on it" do
    project = projects(:slides)
    project.targets.where(kind: "revealjs").destroy_all

    assert project.reload.update(document_type: :article)
  end

  test "an unrestricted target does not block a document_type change" do
    project = projects(:one)
    assert project.targets.any?

    assert project.update(document_type: :book)
  end

  test "full_dup copies target configuration but no build history" do
    original = projects(:two)
    assert original.targets.first.update(published: true)

    copy = original.full_dup(users(:one))
    assert copy.save

    assert_equal original.targets.map(&:name).sort, copy.targets.map(&:name).sort
    copy.targets.each do |target|
      assert_not target.published?, "a copy must not inherit the original's public URLs"
      assert_nil target.current_build_id
      assert_empty target.builds
    end
  end

  # --- Templates ---

  test "templates scope returns only flagged projects" do
    assert_includes Project.templates, projects(:template)
    assert_not_includes Project.templates, projects(:one)
  end

  test "instantiate_from_template_for produces a non-template copy owned by the new user" do
    template = projects(:template)
    copy = template.instantiate_from_template_for(users(:one))
    stub_build_server { copy.save! }

    assert_equal users(:one), copy.user
    assert_not copy.is_template?
    assert_nil copy.template_description
    # Adds "generated from template"
    assert_equal "#{template.title} (generated from template)", copy.title
    assert_equal template.divisions.count, copy.divisions.count
  end

  # --- Collaboration ---

  test "collaborator_limit follows the owner's subscription" do
    assert_equal 1, projects(:one).collaborator_limit
    assert_equal 5, Project.new(user: users(:subscribed)).collaborator_limit
  end

  test "editable_by? covers the owner and accepted collaborators only" do
    project = projects(:one)
    assert project.editable_by?(project.user)
    assert project.editable_by?(users(:two)) # fixture :accepted
    assert_not project.editable_by?(users(:subscribed))
    assert_not project.editable_by?(nil)

    # A pending invite does not grant editing.
    assert_not projects(:two).editable_by?(User.new(email: "invited@example.com"))
  end

  test "full_dup does not copy collaborations" do
    copy = projects(:one).full_dup(users(:subscribed))
    stub_build_server { copy.save! }
    assert_empty copy.collaborations
  end

  # --- Client-minted nested-attribute ids ---
  #
  # The collaborative editor mints a division's/asset's uuid itself so the
  # record exists in the shared document immediately, without waiting on a
  # round trip here. That makes creates arrive under ids Rails has never seen,
  # and destroys arrive more than once. Both used to raise RecordNotFound and
  # take the whole save down with them.

  test "a division sent under a client-minted id is created with that id" do
    project = projects(:one)
    id = SecureRandom.uuid

    stub_build_server do
      project.update!(divisions_attributes: [
        { id: id, ref: "minted-section", source: "<section><title>Minted</title></section>" }
      ])
    end

    division = project.divisions.find(id)
    assert_equal "minted-section", division.ref
    assert_equal "<section><title>Minted</title></section>", division.source
  end

  test "re-sending a client-minted division updates rather than duplicating it" do
    project = projects(:one)
    id = SecureRandom.uuid

    stub_build_server do
      project.update!(divisions_attributes: [ { id: id, ref: "minted-section", source: "<section/>" } ])
      project.reload.update!(divisions_attributes: [ { id: id, source: "<section><title>Again</title></section>" } ])
    end

    assert_equal 1, project.divisions.where(id: id).count
    assert_equal "<section><title>Again</title></section>", project.divisions.find(id).source
  end

  test "an asset sent under a client-minted id is created with that id" do
    project = projects(:one)
    id = SecureRandom.uuid

    stub_build_server do
      project.update!(assets_attributes: [
        { id: id, ref: "minted-asset", kind: "authored", title: "Minted", source: "<p>x</p>" }
      ])
    end

    asset = project.assets.find(id)
    assert_equal "minted-asset", asset.ref
    assert_equal "<p>x</p>", asset.source
  end

  test "destroying a division that is already gone is a no-op, not an error" do
    project = projects(:one)
    division = project.divisions.create!(ref: "doomed", source: "<section/>")

    stub_build_server do
      project.reload.update!(divisions_attributes: [ { id: division.id, _destroy: true } ])
      # The collaborator who removed it persisted that above; the session
      # leader's next bulk save re-sends it from the doc's tombstones.
      project.reload.update!(divisions_attributes: [ { id: division.id, _destroy: true } ])
    end

    assert_not project.divisions.exists?(division.id)
  end

  test "destroying an asset that is already gone is a no-op, not an error" do
    project = projects(:one)
    asset = project.assets.create!(ref: "doomed-asset", kind: "authored", title: "Doomed")

    stub_build_server do
      project.reload.update!(assets_attributes: [ { id: asset.id, _destroy: true } ])
      project.reload.update!(assets_attributes: [ { id: asset.id, _destroy: true } ])
    end

    assert_not project.assets.exists?(asset.id)
  end

  # A destroy naming a row that never existed is dropped rather than turned into
  # a create: the tolerance is only ever allowed to *remove* work.
  test "destroying an id that never existed does not create a record" do
    project = projects(:one)
    before = project.divisions.count

    stub_build_server do
      project.update!(divisions_attributes: [ { id: SecureRandom.uuid, _destroy: true, ref: "ghost" } ])
    end

    assert_equal before, project.reload.divisions.count
  end

  # The one shape that does not arrive as an array: an asset upload, whose file
  # forces a multipart body (`project[assets_attributes][0][ref]`).
  test "index-keyed nested attributes are handled like an array" do
    project = projects(:one)
    id = SecureRandom.uuid

    stub_build_server do
      project.update!(assets_attributes: {
        "0" => { id: id, ref: "keyed-asset", kind: "authored", title: "Keyed" }
      })
    end

    assert_equal "keyed-asset", project.assets.find(id).ref
  end
end
