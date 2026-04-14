class ProjectsController < ApplicationController
  allow_unauthenticated_access only: %i[ share preview ]
  require_unauthenticated_access only: %i[ tryit ]
  before_action :set_project, only: %i[ show edit update destroy editor_state update_editor_state ]
  before_action :limit_projects, only: %i[ new create copy ]
  before_action :require_ownership, only: %i[ show edit update destroy editor_state update_editor_state ]
  after_action :allow_iframe, only: :share
  rate_limit to: 25, within: 10.minutes, only: :preview,
             with: -> { render plain: "Preview limit reached. Please wait a few minutes and try again, or create an account to continue writing and save your work!", status: :too_many_requests },
             if: -> { !authenticated? }

  # GET /projects or /projects.json
  def index
    @projects = Project.where user: @current_user
    @invitations = Invitation.where owner_user: @current_user
  end

  # GET /projects/1 or /projects/1.json
  def show
  end

  # GET /projects/new
  def new
    @project = Project.new(user: @current_user, source_format: :pretext)
  end

  # GET /tryit
  def tryit
    @demo_mode = params[:demo] == "latex" ? "latex" : "pretext"
    @title = @demo_mode == "latex" ? "Try LaTeX-style PreTeXt!" : "Try it!"

    @content = if @demo_mode == "latex"
      <<~EOS
        \\section{Thanks for trying PreTeXt.Plus!}

        This is a LaTeX-style demo project. You can edit this content using supported LaTeX syntax.

        \\[
          \\left|\\sum_{i=0}^n a_i\\right|\\leq\\sum_{i=0}^n |a_i|
        \\]

        Changes you make here will not be saved.
      EOS
    else
      <<~EOS
        <section>
          <title> Thanks for trying PreTeXt.Plus! </title>

          <p>
            This is a very simple project to show you what PreTeXt.Plus can do.
            You can edit its content using the PreTeXt markup language.
            <me>
              \\left|\\sum_{i=0}^n a_i\\right|\\leq\\sum_{i=0}^n|a_i|
            </me>
          </p>

          <fact>
            <statement>
              <p>
                For more information on how to use PreTeXt, please visit <c>https://pretextbook.org/doc/guide/html/</c>.
              </p>
            </statement>
          </fact>

          <note>
            <p>
              Changes you make here will not be saved.
            </p>
          </note>
        </section>
      EOS
    end

    @source_format = @demo_mode
    @docinfo = <<~EOS
      <docinfo>
      <macros>
      \\newcommand{\\N}{\\mathbb N}
      </macros>
      <brandlogo source="icon.svg" />
      </docinfo>
    EOS
  end

  # GET /projects/1/edit
  def edit
  end

  # POST /projects or /projects.json
  def create
    @project = Project.new project_params
    @project.user = @current_user
    @project.source_format = :pretext if @project.source_format.blank?
    @project.title = "New Project" if @project.title.blank?
    @project.set_default_source
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

  # PATCH/PUT /projects/1 or /projects/1.json
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

  # DELETE /projects/1 or /projects/1.json
  def destroy
    @project.destroy!

    respond_to do |format|
      format.html { redirect_to projects_path, notice: "Project was successfully destroyed.", status: :see_other }
      format.json { head :no_content }
    end
  end

  # GET /projects/:id/editor_state
  def editor_state
    render json: @project.to_h
  end

  # PATCH /projects/:id/editor_state
  def update_editor_state
    if @project.update(project_params)
      render json: @project.to_h
    else
      render json: { errors: @project.errors }, status: :unprocessable_entity
    end
  end

  def share
    @project = Project.find(params.expect(:project_id))
    render html: (@project.html_source || "Document not found.").html_safe
  end

  # GET /projects/:project_id/share/copy
  def copy
    @project = Project.find(params.expect(:project_id)).dup
    unless @current_user.has_copiable_projects? or @current_user.admin?
      flash[:alert] = "Only sustaining subscribers can share copiable projects. Consider subscribing for this feature and to support PreTeXt.Plus!"
      redirect_to projects_path and return
    end
    @project.user = @current_user
    @project.title = "Copy of " + @project.title
    @project.save!
    redirect_to edit_project_path(@project)
  end

  def preview
    require "uri"
    require "net/http"
    post_params = {
      source: params[:source],
      title: params[:title],
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
    # return html along with the status returned by build server
    render html: response.body.html_safe, status: response.code
  rescue Net::OpenTimeout, Net::ReadTimeout
    render plain: "Preview build timed out", status: :gateway_timeout
  rescue SocketError, EOFError, IOError, Errno::ECONNREFUSED, Errno::EHOSTUNREACH, SystemCallError
    render plain: "Preview build failed", status: :bad_gateway
  end

  private
    # Use callbacks to share common setup or constraints between actions.
    def set_project
      @project = Project.find(params.expect(:id))
    end

    # Only allow a list of trusted parameters through.
    def project_params
      params.expect(project: [ :title, :source, :pretext_source, :source_format, :docinfo ])
    end

    # redirect if user has too many projects
    def limit_projects
      if @current_user.projects.count >= @current_user.project_quota
        redirect_to projects_path, alert: "Project quota (#{@current_user.project_quota}) cannot be exceeded"
      end
    end

    def require_ownership
      if @project.user != @current_user and !@current_user.admin?
        redirect_to projects_path, alert: "You do not have permission to access this project"
      end
    end
end
