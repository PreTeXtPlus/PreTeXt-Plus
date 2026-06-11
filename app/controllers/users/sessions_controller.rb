class Users::SessionsController < Devise::SessionsController
  def create
    super do |user|
      user.update(tos: Term.current(:tos), privacy: Term.current(:privacy))
    end
  end
end
