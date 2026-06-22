require "test_helper"

class ProjectTest < ActiveSupport::TestCase
  test "before_update calls build server and sets html_source" do
    project = projects(:one)
    stub_build_server do
      project.update!(title: "Updated Title")
    end
    assert_equal "<html><body>stub</body></html>", project.html_source
  end

  test "before_update sends pretext_source to build server" do
    project = projects(:one)
    captured_params = nil
    fake_response = Struct.new(:body).new("<html>built</html>")

    Net::HTTP.stub(:post_form, ->(_uri, params) {
      captured_params = params
      fake_response
    }) do
      project.update!(title: "Updated")
    end

    assert_equal project.pretext_source, captured_params[:source]
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
end
