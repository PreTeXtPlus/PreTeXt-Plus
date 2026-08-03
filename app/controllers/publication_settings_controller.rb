# The publisher-options modal, for whichever of the three levels the path names: the
# signed-in account, a project, or one output.
#
# One controller rather than three because the levels differ only in which record holds
# the settings. Publication::Settings does the resolving, Publication::Catalog decides what
# is on offer, and everything below is about finding the owner and letting them save.
class PublicationSettingsController < ApplicationController
  before_action :set_owner

  # An overlay, so it only ever answers the frame that asks for it. Unlike the target
  # drawer, nothing links here and Turbo leaves the address bar on the page underneath, so
  # a request that is not the frame asking is a stray URL rather than a bookmark -- and
  # gets the page the modal would have opened over, which is somewhere useful.
  def edit
    return redirect_to return_path unless turbo_frame_request_id == "modal"

    @settings = Publication::Settings.new(@owner)
  end

  def update
    # Merged, not replaced: the form only submits the options the modal offered, and a
    # book-turned-article should not silently lose a setting the modal no longer shows.
    # Blank values are how the form says "inherit"; HasPublicationSettings drops them.
    #
    # Merged one setting at a time, too: a modal holds every option of a level, and a value
    # this level cannot accept is a reason to keep that one setting as it was, not a reason
    # to throw away the other changes the author made in the same visit.
    saved, refused = @owner.merge_publication_settings(submitted_settings)

    if !saved
      redirect_to return_path, alert: @owner.errors.full_messages.to_sentence
    elsif refused.any?
      redirect_to return_path, alert: refused_alert(refused)
    else
      redirect_to return_path, notice: "Saved."
    end
  end

  private

    # Whichever parent the path carries. The account level takes current_user and ignores
    # the id in the path, exactly as UsersController#edit does -- there is one account a
    # signed-in author may edit, and it is theirs.
    #
    # The other two go through CanCan, so a collaborator gets the same access to a
    # project's build settings that they have to everything else about it.
    def set_owner
      @owner =
        if params[:target_id]
          Target.find(params[:target_id]).tap { |target| authorize! :update, target }
        elsif params[:project_id]
          Project.find(params[:project_id]).tap { |project| authorize! :update, project }
        else
          current_user
        end
    end

    # Only the catalog's own keys, so a hand-rolled form cannot add a fourth. Values are
    # checked against the catalog by HasPublicationSettings, not here.
    def submitted_settings
      params.fetch(:publication_settings, {})
            .permit(*Publication::Catalog.keys)
            .to_h
    end

    # What did not save, and only that -- everything else already has by the time this is
    # read, so a message about the save as a whole would be wrong. Each line names the
    # setting left alone, the value that could not be stored, and what one looks like: the
    # modal is closed by now, so this sentence is all the author has to go back in with.
    def refused_alert(refused)
      unsaved = refused.map do |option, value|
        "#{option.label} is unchanged: “#{value}” is not #{option.guidance}."
      end

      [ "Saved everything else.", *unsaved ].join(" ")
    end

    # Back to the page the modal opened over, with the drawer reopened when it was an
    # output's settings being edited.
    def return_path
      case @owner
      when Target then project_target_path(@owner.project, @owner)
      when Project then project_path(@owner)
      else edit_user_path(@owner)
      end
    end
end
