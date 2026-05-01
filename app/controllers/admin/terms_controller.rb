class Admin::TermsController < Admin::BaseController
  def new
    @term = Term.new
  end
  def create
    @term = Term.new(term_params)
    if @term.save
      redirect_to :root, notice: "Term was successfully created"
    else
      render :new, status: :unprocessable_entity
    end
  end

  private

  def term_params
    params.expect(term: [ :policy_type, :content ])
  end
end
