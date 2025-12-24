class PagesController < ApplicationController
  allow_unauthenticated_access only: :home
  def home
    render layout: false
  end
end
