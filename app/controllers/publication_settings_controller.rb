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
    @view = requested_view
  end

  # Moves between the modal's two views -- the settings, and the XML they are stored as --
  # taking unsaved work along. The form is applied to the owner in memory, exactly as
  # #update would apply it, and the modal is drawn again from that: so a theme picked in
  # the settings view is in the XML the author is shown, and an attribute typed into the
  # XML is in the select when they come back. Nothing is saved until they press Save.
  #
  # One view at a time, rather than a tab beside the others, because the two edit the same
  # thing: side by side, whichever was not being typed into would be showing something
  # already out of date.
  #
  # XML that would be refused cannot be left: there is no reading settings out of text
  # that does not parse, so the author stays in the XML view with the problems listed.
  def switch
    @document = submitted_document
    @refused = @owner.apply_publication_changes(submitted_settings, xml: (submitted_xml if @document&.valid?))
    @settings = Publication::Settings.new(@owner)
    @view = @document&.errors&.any? ? "xml" : requested_view

    render :edit
  end

  def update
    # Changed fields only, each on its own: the form submits every option the modal
    # offered, but a field the author left alone is left alone in the XML too, and a value
    # this level cannot accept is a reason to keep that one setting as it was, not a reason
    # to throw away the other changes made in the same visit. A blank field is how the
    # form says "inherit". See HasPublicationSettings#apply_publication_changes.
    #
    # XML follows the same rule: text this level cannot accept leaves the XML it had in
    # place. The XML view checks before it submits (see #check), so reaching that branch
    # takes a form that skipped it.
    document = submitted_document
    saved, refused = @owner.merge_publication_settings(
      submitted_settings, xml: (submitted_xml if document&.valid?)
    )

    if !saved
      redirect_to return_path, alert: @owner.errors.full_messages.to_sentence
    elsif refused.any? || document&.errors&.any?
      redirect_to return_path, alert: refused_alert(refused, document)
    elsif (warnings = @owner.publication_document&.warnings).present?
      redirect_to return_path, notice: "Settings saved. The publication XML has " \
        "#{helpers.pluralize(warnings.size, 'warning')} -- see Edit as XML."
    else
      redirect_to return_path, notice: "Settings saved."
    end
  end

  # What the XML view asks before it lets the form submit, and whenever the author
  # presses Check: would this XML be accepted, what should they know about it, and what
  # file would this level's outputs be built with if they saved everything on screen now.
  #
  # Nothing is saved. The form is applied to the owner in memory, exactly as #update would
  # apply it, so the preview is the file a save would produce -- a theme changed on the
  # HTML tab and not yet saved included -- computed no other way than a build computes it.
  def check
    document = submitted_document
    @owner.apply_publication_changes(submitted_settings, xml: (submitted_xml if document&.valid?))
    settings = Publication::Settings.new(@owner)

    render json: {
      errors: document&.errors || [],
      warnings: document&.warnings || [],
      preview: settings.file_preview
    }
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
    #
    # The empty_keys are the companion checkboxes -- form controls rather than settings,
    # which is why they are permitted here and gone by the time this returns: the catalog
    # folds each into the setting it belongs to.
    def submitted_settings
      submitted = params.fetch(:publication_settings, {})
                        .permit(*Publication::Catalog.keys, *Publication::Catalog.empty_keys)
                        .to_h

      Publication::Catalog.fold_empty_choices(submitted)
    end

    # This level's XML as the form carried it, or nil when it carried no such field -- which leaves
    # the stored XML alone. An empty field is a submission: it is how an author clears a
    # level. Line endings are the browser's (a textarea submits CRLF), and are put back so
    # that text nobody edited compares equal to what is stored.
    def submitted_xml
      params[:publication_xml].to_s.gsub("\r\n", "\n") if params.key?(:publication_xml)
    end

    # Which of the modal's two views to draw. Anything but "xml" is the settings.
    def requested_view
      params[:view] == "xml" ? "xml" : "settings"
    end

    # That text parsed, so the response can say how it went; nil with no field.
    def submitted_document
      return @submitted_document if defined?(@submitted_document)

      @submitted_document = submitted_xml &&
        Publication::Document.new(submitted_xml, subscriber: Publication::Settings.new(@owner).subscriber?)
    end

    # What did not save, and only that -- everything else already has by the time this is
    # read, so a message about the save as a whole would be wrong. Each line names the
    # setting left alone, the value that could not be stored, and what one looks like: the
    # modal is closed by now, so this sentence is all the author has to go back in with.
    def refused_alert(refused, document = nil)
      unsaved = refused.map do |option, value|
        "#{option.label} is unchanged: “#{value}” is not #{option.guidance}."
      end
      if document&.errors&.any?
        unsaved << "The publication XML is unchanged: #{document.errors.first}"
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
