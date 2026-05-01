class TermsController < ApplicationController
  allow_unauthenticated_access
  def tos
    @term = Term.current(:tos)
    @term_title = "Terms of Service"
    redirect_to :root if @term.blank?
    render "show"
  end
  def privacy
    @term = Term.current(:privacy)
    @term_title = "Privacy Policy"
    redirect_to :root if @term.blank?
    render "show"
  end
end
