module PublicationSettingsHelper
  # The three levels are three routes with the same shape, so the views that open and
  # submit the modal do not have to know which one they are looking at.
  def edit_publication_settings_path_for(owner)
    case owner
    when Target then edit_project_target_publication_settings_path(owner.project, owner)
    when Project then edit_project_publication_settings_path(owner)
    else edit_user_publication_settings_path(owner)
    end
  end

  def publication_settings_path_for(owner)
    case owner
    when Target then project_target_publication_settings_path(owner.project, owner)
    when Project then project_publication_settings_path(owner)
    else user_publication_settings_path(owner)
    end
  end

  # A grid as the table the modal draws it as: [row label, [option per column]]. The cells
  # come from the grid's own row and column lists rather than from the options in hand, so
  # a cell whose option this level does not offer is a nil the table can leave blank --
  # otherwise the columns after it would shift left and the whole row would read as
  # answering the wrong questions.
  #
  # A row with no options left at all is dropped rather than rendered empty, and a grid
  # left with no rows is dropped by the caller.
  def publication_settings_grid(grid, options)
    by_key = options.index_by(&:key)

    grid.row_list.filter_map do |row_key, row_label|
      cells = grid.columns.map { |column_key, _| by_key[grid.cell_key(row_key, column_key)] }
      [ row_label, cells ] if cells.any?
    end
  end

  # The modal's heading. Names the thing being edited rather than the level, because
  # "Build settings for Print PDF" tells an author which of the three they have open and
  # "Output settings" does not.
  def publication_settings_title(owner)
    case owner
    when Target then "Build settings for #{owner.name}"
    when Project then "Build settings for this project"
    else "Your build settings"
    end
  end

  # One line under the heading saying what this level does to the others. The whole
  # feature is three overlapping scopes, and an author who does not know which one they
  # are editing cannot predict what a build will do.
  def publication_settings_scope_note(owner)
    case owner
    when Target
      "Applies to this output only, overriding the project's settings and your account defaults."
    when Project
      "Applies to every output of this project, overriding your account defaults. " \
        "A single output can override these again."
    else
      "Defaults for every project you own. Any project, or any single output, can override them."
    end
  end
end
