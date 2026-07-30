class ProjectsController < ApplicationController
  allow_unauthenticated_access only: %i[ share preview source ]
  require_unauthenticated_access only: %i[ tryit ]
  load_and_authorize_resource except: %i[ index new tryit preview feedback create_from_template create_from_import ]
  skip_authorize_resource only: %i[ share copy ]
  after_action :allow_iframe, only: :share
  rate_limit to: 25, within: 10.minutes, only: :preview,
             with: -> { render plain: "Preview limit reached. Please wait a few minutes and try again, or create an account to continue writing and save your work!", status: :too_many_requests },
             if: -> { !authenticated? }

  # GET /projects
  def index
    # Each row renders a chip per target, and every chip's state reads both build
    # pointers. Without eager loading that is two queries per target per project; with
    # it, and because Target#state touches nothing else, the page is a fixed handful.
    @projects = Project.where(user: current_user).includes(targets: [ :current_build, :latest_build ])
    # Shared projects render the identical row, so they need the identical eager load.
    @shared_projects = current_user.shared_projects.includes(targets: [ :current_build, :latest_build ])
  end

  # GET /projects/1 or /projects/1.json
  def show
  end

  # GET /projects/new
  def new
    @project = Project.new(user: current_user)
    @project.divisions.build(is_root: true, ref: "document")
    # Templates offered in the "Start project from template" modal. Read-only:
    # picking one duplicates it into the current user's account.
    @templates = Project.templates
  end

  # GET /projects/1/edit
  def edit
  end

  # POST /projects
  def create
    @project.user = current_user
    @project.title = "New Project" if @project.title.blank?
    @project.set_default_docinfo
    respond_to do |format|
      if @project.save
        format.html { redirect_to edit_project_path(@project) }
      else
        # The chooser page needs its template list even on a validation re-render,
        # since the `new` action body doesn't run on this path.
        @templates = Project.templates
        format.html { render :new, status: :unprocessable_entity }
      end
    end
  end

  # POST /projects/from_template/:template_id
  # Duplicate a team-curated template into the current user's account.
  def create_from_template
    # Only projects actually flagged as templates are copyable here, regardless
    # of which account owns them.
    template = Project.templates.find(params[:template_id])
    project = template.instantiate_from_template_for(current_user)
    if project.save
      redirect_to edit_project_path(project)
    else
      alert = project.errors.full_messages.to_sentence.presence || "Could not create a project from that template."
      redirect_to new_project_path, alert: alert
    end
  end

  # POST /projects/import
  # Create a project from an @pretextbook/import result (posted as multipart so
  # asset bytes come through as real uploads). Returns the editor URL as JSON;
  # the import wizard redirects the browser there.
  def create_from_import
    @project = Project.new(import_params)
    @project.user = current_user
    @project.title = "Imported Project" if @project.title.blank?
    @project.set_default_docinfo if @project.docinfo.blank?
    if @project.save
      render json: { project_url: edit_project_path(@project) }, status: :created
    else
      render json: { errors: @project.errors.full_messages }, status: :unprocessable_entity
    end
  end

  # PATCH/PUT /projects/1 or /projects/1.json
  def update
    respond_to do |format|
      if @project.update(project_params)
        format.json { render :show, status: :ok, location: @project }
        format.html { redirect_to @project, notice: "Project was successfully updated." }
      else
        format.json { render json: @project.errors, status: :unprocessable_entity }
        format.html { redirect_to @project, alert: @project.errors.full_messages.to_sentence }
      end
    end
  rescue ActiveRecord::RecordNotUnique
    # A nested division/asset named a record id that already exists on some
    # *other* project. Project#tolerate_client_minted_ids treats an id this
    # project has never seen as an insert -- which is what lets the editor mint
    # its own uuids -- so an id belonging elsewhere reaches the database as a
    # primary-key conflict. It cannot read or touch that other row, but it can
    # raise here, so answer it as the bad request it is rather than a 500.
    render json: { error: "A record id in this request belongs to another project." },
           status: :unprocessable_entity
  end

  # DELETE /projects/1
  def destroy
    @project.destroy!

    respond_to do |format|
      format.html { redirect_to projects_path, notice: "Project was successfully destroyed.", status: :see_other }
    end
  end

  # Legacy share link. These URLs are already in the world -- handed to students,
  # possibly printed in syllabi -- so the route stays permanently. Once the project has
  # a published html output, that is the better destination; until then it keeps
  # serving the quick build as before.
  #
  # Found, not Moved Permanently: a browser that cached a 301 would keep redirecting
  # after the target was unpublished.
  def share
    # A browsable site, not merely something html-derived: redirecting a link handed to
    # students at a SCORM package would be worse than the quick build it replaces.
    published = @project.targets.detect { |t| t.site? && t.published? && t.current_build_id }
    if published
      # Cross-origin in production: the public URL lives on the published origin, which
      # is the point -- this redirect is how legacy same-origin links stop serving user
      # content from the origin that holds sessions.
      return redirect_to helpers.target_public_url(published), status: :found, allow_other_host: true
    end

    # The quick build is user HTML too, so it renders only on the published origin;
    # reached on any other host, this bounces there first (the routes mount this same
    # action on the published host). Development configures no published origin and
    # renders in place, as before.
    origin = Rails.application.config.x.published_url_options.presence
    if origin && request.host != origin[:host]
      return redirect_to share_project_url(@project, **origin), status: :found, allow_other_host: true
    end

    render html: (@project.html_source || "Document not found").html_safe
  end

  # The whole project as a PreTeXt-CLI-compatible zip: source, assets, project.ptx and
  # publication.ptx. The escape hatch -- someone choosing where to keep five years of
  # writing should be able to leave with it.
  def download
    send_data ProjectArchiveBuilder.new(@project).build.read,
              filename: "#{@project.title.parameterize.presence || 'project'}.zip",
              type: "application/zip"
  end

  def source
  end

  # GET /projects/:project_id/share/copy
  def copy
    project_copy = @project.full_dup(current_user)
    if project_copy.save
      redirect_to edit_project_path(project_copy)
    else
      alert = project_copy.errors.full_messages.to_sentence.presence || "Copy failed."
      redirect_to copy_project_path(@project), alert: alert
    end
  end

  def preview
    require "uri"
    require "net/http"
    post_params = {
      source: params[:source],
      token: Rails.application.credentials.dig(:preview_build, :token)
    }
    uri = URI.parse("https://#{Rails.application.credentials.dig(:preview_build, :host)}")
    response = Net::HTTP.start(
      uri.host,
      uri.port,
      use_ssl: uri.scheme == "https",
      open_timeout: 5,
      read_timeout: 15
    ) do |http|
      request = Net::HTTP::Post.new(uri.request_uri)
      request["Content-Type"] = "application/x-www-form-urlencoded"
      request.body = URI.encode_www_form(post_params)
      http.request(request)
    end
    render html: response.body.html_safe, status: response.code
  rescue Net::OpenTimeout, Net::ReadTimeout
    render plain: "Preview build timed out", status: :gateway_timeout
  rescue SocketError, EOFError, IOError, Errno::ECONNREFUSED, Errno::EHOSTUNREACH, SystemCallError
    render plain: "Preview build failed", status: :bad_gateway
  end

  # GET /tryit
  def tryit
    @project = Project.tryit
  end

  # POST /projects/feedback
  def feedback
    feedback_data = {
      context: params[:context],
      message: params[:message],
      email: params[:email],
      project_url: params[:project_url],
      submitted_at: params[:submitted_at],
      user: current_user
    }

    FeedbackMailer.feedback_submission(feedback_data).deliver_later

    render json: { status: "success" }, status: :accepted
  rescue StandardError => e
    Rails.logger.error("Feedback submission error: #{e.message}")
    render json: { error: "Failed to submit feedback" }, status: :internal_server_error
  end

  private
    # Only allow a list of trusted parameters through.
    def project_params
      params.expect(project: [
        :title, :pretext_source, :docinfo, :use_common_docinfo, :visibility,
        divisions_attributes: [ [ :id, :source, :source_format, :is_root, :ref, :_destroy ] ],
        assets_attributes: [ [ :id, :ref, :kind, :file, :source, :short_description, :description, :title, :_destroy ] ]
      ])
    end

    # The import wizard posts what @pretextbook/import already emits, in this
    # controller's own shape (see react/import.jsx), so there is nothing to
    # rename here. Divisions and assets arrive as brand-new records (no id), so
    # no id/_destroy is permitted.
    #
    # The one thing that can't ride along as JSON is an asset's bytes: they
    # arrive base64-encoded in `file`, and are decoded back into an
    # ActiveStorage attachable below.
    def import_params
      attrs = params.expect(project: [
        :title, :docinfo, :document_type,
        divisions_attributes: [ [ :ref, :source, :source_format, :is_root ] ],
        assets_attributes: [ [ :ref, :kind, :title, :short_description,
                               { file: [ :filename, :content_type, :data ] } ] ]
      ]).to_h.deep_symbolize_keys

      if attrs[:assets_attributes].present?
        attrs[:assets_attributes] = attrs[:assets_attributes].map { |asset| decode_import_asset(asset) }
      end
      attrs
    end

    # Swap an imported asset's base64 `file` object for something ActiveStorage
    # can attach.
    def decode_import_asset(asset)
      file = asset[:file]
      return asset if file.blank?

      asset.merge(file: {
        io: StringIO.new(file[:data].to_s.unpack1("m") || ""),
        filename: file[:filename].presence || asset[:ref].presence || "asset",
        content_type: file[:content_type].presence || "application/octet-stream"
      })
    end
end
