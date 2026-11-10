require "test_helper"

class AssetRendersControllerTest < ActionDispatch::IntegrationTest
  setup do
    @project = projects(:one)
    @asset = @project.assets.create!(kind: :authored_asset, source_format: "asymptote", ref: "circle", title: "Circle",
                                     source: "draw(unitcircle);")
    sign_in users(:one)
  end

  def create_render(ref: "circle", source: "size(3cm);\ndraw(unitcircle);")
    post project_asset_renders_url(@project), params: { ref: ref, source: source }, as: :json
  end

  # The controller is the seam between the editor and AssetRenderer; the renderer's
  # own behaviour is in its test. Here it is stubbed to record what it was handed.
  test "create submits the source as sent, under the asset's row, and answers with a poll URL" do
    seen = nil
    submit = lambda do |project, rendered|
      seen = { project: project, rendered: rendered }
      "/generate/job-1"
    end
    AssetRenderer.stub(:submit, submit) { create_render }

    assert_response :accepted
    assert_equal @project, seen[:project]
    assert_equal "size(3cm);\ndraw(unitcircle);", seen[:rendered].source
    assert_equal "asymptote", seen[:rendered].source_format
    assert_equal "circle", seen[:rendered].ref
    assert seen[:rendered].new_record?, "the render's source must never be saved to the row"
    assert_equal "draw(unitcircle);", @asset.reload.source

    poll_url = response.parsed_body["poll_url"]
    assert_match %r{\A/projects/#{@project.id}/asset_renders/status\?token=}, poll_url
  end

  test "the poll URL relays the job's state for the project it was issued to" do
    AssetRenderer.stub(:submit, ->(*) { "/generate/job-1" }) { create_render }
    poll_url = response.parsed_body["poll_url"]

    polled = nil
    poll = lambda do |status_url, element|
      polled = [ status_url, element ]
      AssetRenderer::Result.new(status: "success", svg: "<svg/>")
    end
    AssetRenderer.stub(:poll, poll) { get poll_url }

    assert_response :success
    assert_equal [ "/generate/job-1", "asymptote" ], polled
    assert_equal({ "status" => "success", "svg" => "<svg/>" }, response.parsed_body)
  end

  test "a claim issued for another project is not found here" do
    AssetRenderer.stub(:submit, ->(*) { "/generate/job-1" }) { create_render }
    token = Rack::Utils.parse_query(URI(response.parsed_body["poll_url"]).query)["token"]

    other = projects(:two)
    sign_in users(:two)
    get status_project_asset_renders_url(other, token: token)
    assert_response :not_found
  end

  test "a forged or expired claim is not found" do
    get status_project_asset_renders_url(@project, token: "nonsense")
    assert_response :not_found
  end

  test "only an asset the build server renders can be rendered" do
    @project.assets.create!(kind: :authored_asset, source_format: "prefigure", ref: "graph", title: "Graph", source: "<diagram/>")
    create_render(ref: "graph")
    assert_response :unprocessable_entity

    create_render(ref: "no-such-asset")
    assert_response :unprocessable_entity
  end

  test "a render the build server refuses is a bad gateway with a plain-language message" do
    AssetRenderer.stub(:submit, ->(*) { raise AssetRenderer::Error, "HTTP 401" }) { create_render }
    assert_response :bad_gateway
    assert_equal AssetRendersController::UNAVAILABLE, response.parsed_body["error"]
  end

  test "a source that will not assemble is a bad gateway too, not a crash" do
    AssetRenderer.stub(:submit, ->(*) { raise SourceAssembler::AssemblyError, "assembler: boom" }) { create_render }
    assert_response :bad_gateway
  end

  test "someone without edit access to the project is refused" do
    sign_in users(:subscribed)
    create_render
    assert_response :forbidden
  end
end
