# Adding, removing and reordering the projects in one of the author's collections.
# Scoped through current_user like CollectionsController: anyone else's is a 404.
class CollectionMembershipsController < ApplicationController
  load_and_authorize_resource :collection, through: :current_user
  load_and_authorize_resource :collection_membership, through: :collection, except: :create

  # POST /collections/:collection_id/memberships
  def create
    project = current_user.projects.find_by(id: params[:project_id])
    return redirect_to(@collection, alert: "Choose one of your own projects to add.") unless project

    membership = @collection.collection_memberships.build(project: project)
    authorize! :create, membership

    if membership.save
      redirect_to @collection, notice: "Added “#{project.title}”."
    else
      redirect_to @collection, alert: membership.errors.full_messages.to_sentence
    end
  end

  # DELETE /collections/:collection_id/memberships/:id
  def destroy
    @collection_membership.destroy!
    redirect_to @collection, notice: "Removed “#{@collection_membership.project.title}” from this collection."
  end

  # PATCH /collections/:collection_id/memberships/:id/move?direction=up|down
  def move
    direction = params[:direction]
    return head :bad_request unless %w[ up down ].include?(direction)

    @collection_membership.move!(direction)
    redirect_to @collection
  end
end
