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

  test "assets_attributes creates an asset with a client-supplied UUID" do
    project = projects(:one)
    new_id = SecureRandom.uuid
    stub_build_server do
      project.update!(assets_attributes: [
        { id: new_id, ref: "fig-one", kind: "file", title: "Figure" }
      ])
    end
    asset = project.assets.find(new_id)
    assert_equal "fig-one", asset.ref
  end

  test "renaming an asset's ref keeps its UUID stable" do
    project = projects(:one)
    asset = project.assets.create!(ref: "before-rename", kind: :file, title: "Figure")
    original_id = asset.id
    stub_build_server do
      project.update!(assets_attributes: [ { id: original_id, ref: "after-rename" } ])
    end
    assert_equal original_id, asset.reload.id
    assert_equal "after-rename", asset.ref
  end

  test "assets_attributes destroys an asset with _destroy" do
    project = projects(:one)
    asset = project.assets.create!(ref: "doomed-asset", kind: :file, title: "Figure")
    stub_build_server do
      assert_difference -> { project.assets.count }, -1 do
        project.update!(assets_attributes: [ { id: asset.id, _destroy: true } ])
      end
    end
  end
end
