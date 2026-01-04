class PagesController < ApplicationController
  allow_unauthenticated_access only: :home
  def home
    @start_writing_path = tryit_path
    if @current_user.present?
      @start_writing_path = projects_path
    end
    render layout: false
  end
end
