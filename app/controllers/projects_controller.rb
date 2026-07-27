class ProjectsController < ApplicationController
  allow_unauthenticated_access only: %i[ share preview source copy_redirect ]
  require_unauthenticated_access only: %i[ tryit ]
  before_action :limit_projects, only: %i[ new create copy create_from_template create_from_import ]
  load_and_authorize_resource except: %i[ index new tryit preview feedback copy_redirect create_from_template create_from_import ]
  skip_authorize_resource only: %i[ share ]
  after_action :allow_iframe, only: :share
  rate_limit to: 25, within: 10.minutes, only: :preview,
             with: -> { render plain: "Preview limit reached. Please wait a few minutes and try again, or create an account to continue writing and save your work!", status: :too_many_requests },
             if: -> { !authenticated? }

  # GET /projects
  def index
    @projects = Project.where user: current_user
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
    project = template.instantiate_for(current_user)
    if project.save
      redirect_to edit_project_path(project)
    else
      redirect_to new_project_path, alert: "Could not create a project from that template."
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

  # PATCH/PUT /projects/1.json
  def update
    respond_to do |format|
      if @project.update(project_params)
        @project.enqueue_html_source_job if params[:enqueue_html_source_job]
        format.json { render :show, status: :ok, location: @project }
      else
        format.json { render json: @project.errors, status: :unprocessable_entity }
      end
    end
  end

  # DELETE /projects/1
  def destroy
    @project.destroy!

    respond_to do |format|
      format.html { redirect_to projects_path, notice: "Project was successfully destroyed.", status: :see_other }
    end
  end

  def share
    render html: (@project.html_source || "Document not found").html_safe
  end

  def source
  end

  # GET /projects/:project_id/share/copy
  def copy
    project_copy = @project.full_dup(current_user)
    if project_copy.save
      redirect_to edit_project_path(project_copy)
    else
      redirect_to copy_project_path(@project), alert: "Copy failed."
    end
  end

  def copy_redirect
    redirect_to share_source_project_path(params[:id])
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
        :title, :pretext_source, :docinfo, :use_common_docinfo,
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

    def limit_projects
      return unless cannot?(:create, Project)

      quota_message = "Project quota (#{current_user.project_quota}) cannot be exceeded.  Consider upgrading your subscription for more projects and to support PreTeXt.Plus!"

      if request.format.json?
        render json: { error: quota_message }, status: :unprocessable_entity
      else
        redirect_to projects_path, alert: quota_message
      end
    end
end
