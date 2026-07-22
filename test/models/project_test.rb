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

  # --- Templates ---

  test "templates scope returns only flagged projects" do
    template = projects(:two)
    template.update!(is_template: true)
    assert_includes Project.templates, template
    assert_not_includes Project.templates, projects(:one)
  end

  test "instantiate_for produces a non-template copy owned by the new user" do
    template = projects(:one)
    template.update!(is_template: true, template_description: "A starter")
    copy = template.instantiate_for(users(:two))
    stub_build_server { copy.save! }

    assert_equal users(:two), copy.user
    assert_not copy.is_template?
    assert_nil copy.template_description
    # Keeps the template's own title rather than "Copy of ...".
    assert_equal template.title, copy.title
    assert_equal template.divisions.count, copy.divisions.count
  end
end
