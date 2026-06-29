require "test_helper"

class ProjectTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper
  test "enqueue_html_source_job writes placeholder to html_source immediately" do
    project = projects(:one)
    project.enqueue_html_source_job
    assert_equal "<p>Generating new quick build... (Refresh to update.)</p>", project.reload.html_source
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

  test "divisions_attributes creates a division with a client-supplied UUID" do
    project = projects(:one)
    new_id = SecureRandom.uuid
    stub_build_server do
      project.update!(divisions_attributes: [
        { id: new_id, ref: "sec-new", source: "<section xml:id=\"sec-new\"/>", source_format: 0 }
      ])
    end
    division = project.divisions.find(new_id)
    assert_equal "sec-new", division.ref
    assert_not division.is_root
  end

  test "divisions_attributes updates an existing division in place" do
    project = projects(:one)
    division = project.root_division
    stub_build_server do
      project.update!(divisions_attributes: [ { id: division.id, ref: "renamed" } ])
    end
    assert_equal "renamed", division.reload.ref
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

  test "divisions_attributes destroys a division with _destroy" do
    project = projects(:one)
    division = project.divisions.create!(ref: "doomed", source: "<section/>", source_format: 0)
    stub_build_server do
      assert_difference -> { project.divisions.count }, -1 do
        project.update!(divisions_attributes: [ { id: division.id, _destroy: true } ])
      end
    end
  end

  test "project_assets_attributes creates a project_asset with a client-supplied UUID" do
    project = projects(:one)
    library_asset = LibraryAsset.create!(user: project.user, kind: :file, short_description: "Figure")
    new_id = SecureRandom.uuid
    stub_build_server do
      project.update!(project_assets_attributes: [
        { id: new_id, ref: "fig-one", library_asset_id: library_asset.id }
      ])
    end
    project_asset = project.project_assets.find(new_id)
    assert_equal "fig-one", project_asset.ref
    assert_equal library_asset.id, project_asset.library_asset_id
  end

  test "renaming a project_asset's ref keeps its UUID stable" do
    project = projects(:one)
    library_asset = LibraryAsset.create!(user: project.user, kind: :file, short_description: "Figure")
    project_asset = project.project_assets.create!(ref: "before-rename", library_asset: library_asset)
    original_id = project_asset.id
    stub_build_server do
      project.update!(project_assets_attributes: [ { id: original_id, ref: "after-rename" } ])
    end
    assert_equal original_id, project_asset.reload.id
    assert_equal "after-rename", project_asset.ref
  end

  test "project_assets_attributes destroys membership with _destroy but keeps the library asset" do
    project = projects(:one)
    library_asset = LibraryAsset.create!(user: project.user, kind: :file, short_description: "Figure")
    project_asset = project.project_assets.create!(ref: "doomed-asset", library_asset: library_asset)
    stub_build_server do
      assert_difference -> { project.project_assets.count }, -1 do
        project.update!(project_assets_attributes: [ { id: project_asset.id, _destroy: true } ])
      end
    end
    assert LibraryAsset.exists?(library_asset.id), "library asset should survive removal from project"
  end
end
