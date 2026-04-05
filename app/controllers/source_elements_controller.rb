class SourceElementsController < ApplicationController
  before_action :set_project
  before_action :require_ownership
  before_action :set_source_element, only: [ :show, :update, :destroy, :move ]

  # GET /projects/:project_id/source_elements
  def index
    render json: tree_json(root_elements)
  end

  # GET /projects/:project_id/source_elements/:id
  def show
    render json: element_json(@source_element)
  end

  # POST /projects/:project_id/source_elements
  def create
    @source_element = @project.source_elements.new(source_element_params)

    if @source_element.save
      render json: element_json(@source_element), status: :created
    else
      render json: { errors: @source_element.errors }, status: :unprocessable_entity
    end
  end

  # PATCH /projects/:project_id/source_elements/:id
  def update
    if @source_element.update(source_element_params)
      render json: element_json(@source_element), status: :ok
    else
      render json: { errors: @source_element.errors }, status: :unprocessable_entity
    end
  end

  # DELETE /projects/:project_id/source_elements/:id
  def destroy
    @source_element.destroy!
    head :no_content
  end

  # PATCH /projects/:project_id/source_elements/:id/move
  # Reparent an element: { parent_id: <new_parent_uuid_or_null>, position: <int> }
  def move
    new_parent_id = params[:parent_id]
    new_position = params[:position]&.to_i || 0

    if new_parent_id.present?
      new_parent = @project.source_elements.find(new_parent_id)
      @source_element.update!(parent: new_parent, position: new_position)
    else
      @source_element.update!(parent: nil, position: new_position)
    end

    render json: element_json(@source_element), status: :ok
  end

  # PATCH /projects/:project_id/source_elements/reorder
  # Batch update positions: { order: [{ id: <uuid>, position: <int> }, ...] }
  def reorder
    order_params = params.expect(order: [ [ :id, :position ] ])

    ActiveRecord::Base.transaction do
      order_params.each do |item|
        @project.source_elements.find(item[:id]).update!(position: item[:position].to_i)
      end
    end

    render json: tree_json(root_elements), status: :ok
  end

  private

  def set_project
    @project = Project.find(params.expect(:project_id))
  end

  def set_source_element
    @source_element = @project.source_elements.find(params.expect(:id))
  end

  def require_ownership
    unless @project.user == @current_user || @current_user&.admin?
      render json: { error: "Not authorized" }, status: :forbidden
    end
  end

  def source_element_params
    params.expect(source_element: [ :element_type, :title, :source, :pretext_source, :parent_id, :position ])
  end

  def root_elements
    @project.source_elements.where(parent_id: nil).order(:position)
  end

  def element_json(element)
    {
      id: element.id,
      project_id: element.project_id,
      parent_id: element.parent_id,
      element_type: element.element_type,
      title: element.title,
      source: element.source,
      pretext_source: element.pretext_source,
      position: element.position,
      container: element.container?,
      children: element.children.order(:position).map { |c| element_json(c) }
    }
  end

  def tree_json(elements)
    elements.map { |e| element_json(e) }
  end
end
