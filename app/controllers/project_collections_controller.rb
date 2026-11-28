# Sets which of the owner's collections hold a project, from that project's
# dashboard. Only the owner files a project (see CollectionMembership), so
# collaborators -- and admins, whose collections are their own -- are turned away.
class ProjectCollectionsController < ApplicationController
  load_and_authorize_resource :project

  # PATCH /projects/:project_id/collections
  def update
    raise CanCan::AccessDenied unless @project.user == current_user

    wanted = current_user.collections.where(id: Array(params[:collection_ids]).compact_blank).to_a
    current = @project.collections.where(user: current_user).to_a

    Collection.transaction do
      @project.collection_memberships.where(collection: current - wanted).destroy_all
      (wanted - current).each { |collection| collection.collection_memberships.create!(project: @project) }
    end

    redirect_to @project, notice: "Collections updated."
  end
end
