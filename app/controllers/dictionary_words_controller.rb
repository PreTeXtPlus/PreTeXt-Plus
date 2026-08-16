# The project's spell-check dictionary: words an author declared correct from
# the editor's "Add to dictionary" quick fix. See Project#add_dictionary_word
# for why they belong to the project rather than to a browser or an account.
class DictionaryWordsController < ApplicationController
  before_action :set_project

  # POST /projects/:project_id/dictionary_words
  # One word per request, and idempotent: the editor fires this off without
  # waiting for it (the word is already accepted client-side), so re-sending one
  # that is already stored has to be a no-op rather than an error.
  def create
    if @project.add_dictionary_word(params[:word])
      head :no_content
    else
      head :unprocessable_entity
    end
  end

  private

    def set_project
      @project = Project.find(params[:project_id])
      # Anyone who can edit the project can teach its dictionary -- a collaborator
      # is a co-author, and a book they can rewrite they can also spell check.
      authorize! :update, @project
    end
end
