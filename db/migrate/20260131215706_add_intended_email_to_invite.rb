class AddIntendedEmailToInvite < ActiveRecord::Migration[8.1]
  def change
    add_column :invitations, :intended_email, :string
  end
end
