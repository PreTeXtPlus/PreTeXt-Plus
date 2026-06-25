class ProjectsController < ApplicationController
  allow_unauthenticated_access only: %i[ share preview source ]
  require_unauthenticated_access only: %i[ tryit ]
  before_action :limit_projects, only: %i[ new create copy ]
  load_and_authorize_resource except: %i[ index new tryit preview feedback ]
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
        format.json { render :show, status: :created, location: @project }
      else
        format.html { render :new, status: :unprocessable_entity }
        format.json { render json: @project.errors, status: :unprocessable_entity }
      end
    end
  end

  # PATCH/PUT /projects/1.json
  def update
    respond_to do |format|
      if @project.update(project_params)
        format.html { redirect_to @project, notice: "Project was successfully updated.", status: :see_other }
        format.json { render :show, status: :ok, location: @project }
      else
        format.html { render :edit, status: :unprocessable_entity }
        format.json { render json: @project.errors, status: :unprocessable_entity }
      end
    end
  end

  # DELETE /projects/1
  def destroy
    @project.destroy!

    respond_to do |format|
      format.html { redirect_to projects_path, notice: "Project was successfully destroyed.", status: :see_other }
      format.json { head :no_content }
    end
  end

  def share
    render html: (@project.html_source || "Document not found").html_safe
  end

  def source
  end

  # GET /projects/:project_id/share/copy
  def copy
    project_copy = @project.full_dup
    project_copy.user = current_user
    project_copy.save!
    redirect_to edit_project_path(project_copy)
  end

  def preview
    require "uri"
    require "net/http"
    post_params = {
      source: params[:source],
      token: ENV["BUILD_TOKEN"]
    }
    uri = URI.parse("https://#{ENV['BUILD_HOST']}")
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
    # The assembled source only ever carries a bare `external/<id>.<ext>`
    # reference for an image (see editor.jsx's assetsForBuild) -- the build
    # server treats `source` as a plain PreTeXt external-asset filename and
    # writes `external/<that value>` into the output `<img src>` itself. A
    # root-relative <base> pins that relative path at the owner-scoped
    # redirect (library_assets#preview_file) regardless of where this HTML
    # ends up displayed (this response is always shown in an iframe, so the
    # base resolves against our own origin either way).
    render html: "<base href=\"/preview_assets/\">#{response.body}".html_safe, status: response.code
  rescue Net::OpenTimeout, Net::ReadTimeout
    render plain: "Preview build timed out", status: :gateway_timeout
  rescue SocketError, EOFError, IOError, Errno::ECONNREFUSED, Errno::EHOSTUNREACH, SystemCallError
    render plain: "Preview build failed", status: :bad_gateway
  end

  # GET /tryit
  def tryit
    @demo_mode = params[:demo] == "pretext" ? "pretext" :
      params[:demo] == "markdown" ? "markdown" : "latex"

    @title = @demo_mode == "latex" ? "Try LaTeX-style PreTeXt!" :
      @demo_mode == "markdown" ? "Try Markdown-style PreTeXt!" : "Try Classic PreTeXt!"

    @content = if @demo_mode == "latex"
      File.read Rails.root.join("app", "default_docs", "tryit", "latex.tex")
    elsif @demo_mode == "markdown"
      File.read Rails.root.join("app", "default_docs", "tryit", "markdown.md")
    else
      File.read Rails.root.join("app", "default_docs", "tryit", "pretext.xml")
    end

    @docinfo = File.read Rails.root.join("app", "default_docs", "tryit", "docinfo.xml")

    @source_format = @demo_mode
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
        project_assets_attributes: [ [ :id, :ref, :library_asset_id, :_destroy ] ]
      ])
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
