class Users::SessionsController < Devise::SessionsController
  def create
    super do |user|
      user.update_terms
    end
  end
end
