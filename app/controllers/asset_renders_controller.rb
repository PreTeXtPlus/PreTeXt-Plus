# The editor's "Render" for a generated asset no browser engine runs (an Asymptote
# figure, a Sage plot): the picture is made by the full build server, through
# AssetRenderer. Stateless with respect to the asset's row: the editor sends the
# source as typed, gets the picture back, and stores it itself through the same
# upload a browser render takes (ProjectsController#update), with the digest of
# exactly what it rendered. Nothing here writes to the asset.
#
# Two steps, because the build server is asynchronous: `create` submits and answers
# with a URL to poll; `status` relays the job's state and, once it is done, the
# picture. The poll URL carries a signed claim -- the job's status URL, bound to this
# project -- rather than a row, so there is nothing to clean up and nothing another
# project's member can read.
class AssetRendersController < ApplicationController
  load_and_authorize_resource :project
  before_action { authorize! :update, @project }

  # Each render starts a container on the build server's one generate worker, so the
  # cost is real. Generous for an author iterating on a figure, tight against a loop.
  rate_limit to: 30, within: 10.minutes, only: :create,
             with: -> { render json: { error: "You've asked for a lot of renders recently. Please wait a few minutes and try again." }, status: :too_many_requests }

  CLAIM_TTL = 1.hour

  # POST /projects/:project_id/asset_renders  { ref, source }
  def create
    asset = @project.assets.find_by(kind: :authored_asset, ref: params[:ref].to_s)
    unless asset && Content::GeneratedAssetBehavior::SERVER_RENDERED_FORMATS.include?(asset.source_format)
      return render json: { error: "That asset is not one the build server renders." }, status: :unprocessable_entity
    end

    # The source as the editor holds it, which may be newer than the row's; never saved.
    rendered = Content.new(project: @project, kind: :authored_asset, source_format: asset.source_format,
                           ref: asset.ref, title: asset.title, source: params[:source].to_s)
    status_url = AssetRenderer.submit(@project, rendered)
    claim = verifier.generate({ project_id: @project.id, status_url: status_url, element: asset.generated_element },
                              expires_in: CLAIM_TTL)
    render json: { poll_url: status_project_asset_renders_path(@project, token: claim) }, status: :accepted
  rescue SourceAssembler::AssemblyError, AssetRenderer::Error => e
    Rails.logger.error("AssetRendersController could not submit a render for project #{@project.id}: #{e.message}")
    render json: { error: e.message }, status: :bad_gateway
  end

  # GET /projects/:project_id/asset_renders/status?token=…
  def status
    claim = verifier.verified(params[:token].to_s)
    raise ActiveRecord::RecordNotFound unless claim && claim["project_id"] == @project.id

    render json: AssetRenderer.poll(claim["status_url"], claim["element"]).to_h.compact
  rescue AssetRenderer::Error => e
    render json: { error: e.message }, status: :bad_gateway
  end

  private

    def verifier
      Rails.application.message_verifier("asset_render")
    end
end
