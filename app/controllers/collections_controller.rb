# An author's own collections. Every lookup goes through current_user, so anyone
# else's collection -- visible or not -- is a 404 here, admins included. Others will
# reach public and unlisted collections through their own routes (Ability's public
# :read rule is there for those).
class CollectionsController < ApplicationController
  load_and_authorize_resource through: :current_user

  # GET /collections
  def index
    @collections = current_user.collections.with_projects_count
      .order(updated_at: :desc).page(params[:page]).per(20)
  end

  # GET /collections/:id
  def show
    @memberships = @collection.collection_memberships
      .includes(project: [ :user, { targets: [ :current_build, :latest_build ] } ])
      .to_a
    @addable_projects = current_user.projects.where.not(id: @memberships.map(&:project_id)).order(:title)
  end

  # GET /collections/new
  def new
    @project = filing_project
  end

  # GET /collections/:id/edit
  def edit
  end

  # POST /collections
  def create
    @project = filing_project

    # The project can only fail to file if something is off with the collection
    # itself, so one transaction and the collection's own errors cover both.
    saved = Collection.transaction do
      @collection.save && (@project.nil? || @collection.collection_memberships.create!(project: @project))
    end

    if saved
      redirect_to @project || @collection, notice: "Collection created."
    else
      render :new, status: :unprocessable_entity
    end
  end

  # PATCH /collections/:id
  def update
    if @collection.update(collection_params)
      redirect_to @collection, notice: "Collection updated."
    else
      render :edit, status: :unprocessable_entity
    end
  end

  # DELETE /collections/:id
  def destroy
    @collection.destroy!
    redirect_to collections_path, notice: "Collection deleted. Its projects are untouched."
  end

  private

  def collection_params
    params.require(:collection).permit(:name, :slug, :description, :visibility)
  end

  # The project to file into a collection made from that project's dashboard. Only
  # one the author owns -- anything else is silently dropped, not an error.
  def filing_project
    id = params[:project_id].presence
    id && current_user.projects.find_by(id: id)
  end
end
