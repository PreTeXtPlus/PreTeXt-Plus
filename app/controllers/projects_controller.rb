class ProjectsController < ApplicationController
  allow_unauthenticated_access only: :share
  require_unauthenticated_access only: :tryit
  before_action :set_project, only: %i[ show edit update destroy ]
  before_action :limit_projects, only: %i[ new create copy ]
  before_action :require_ownership, only: %i[ show edit update destroy ]
  after_action :allow_iframe, only: :share

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
    @title = "Try it!"
    @content = <<-eos
<section>
  <title> Thanks for trying PreTeXt.Plus! </title>

  <p>
    This is a sample project to show you what PreTeXt.Plus can do.
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

  <p>
    Click <em>Create your account</em> to be able to write and save your work!
  </p>
</section>
    eos
  end

  # GET /projects/1/edit
  def edit
  end

  # POST /projects or /projects.json
  def create
    @project = Project.new(safe_project_params)
    @project.user = @current_user
    @project.source_format ||= :pretext
    @project.title = "New Project" if @project.title.blank?
    @project.source = Project.default_content_for(@project.source_format)

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
      if @project.update(safe_project_params)
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

  def share
    @project = Project.find(params.expect(:project_id))
    render html: (@project.html_source || "").html_safe
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

  private
    # Use callbacks to share common setup or constraints between actions.
    def set_project
      @project = Project.find(params.expect(:id))
    end

    # Only allow a list of trusted parameters through.
    def project_params
      params.expect(project: [ :title, :source, :pretext_source, :source_format, :document_type ])
    end

    # Strips enum fields to known values before mass-assignment so invalid
    # inputs produce nil (handled by validations) rather than ArgumentError.
    def safe_project_params
      p = project_params
      p[:source] = p.delete(:content) if p.key?(:content) && !p.key?(:source)
      p[:pretext_source] = p.delete(:pretext_content) if p.key?(:pretext_content) && !p.key?(:pretext_source)
      if p.key?(:source_format)
        p[:source_format] = p[:source_format].presence_in(Project.source_formats.keys)
      end
      if p.key?(:document_type)
        p[:document_type] = p[:document_type].presence_in(Project.document_types.keys)
      end
      p
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
