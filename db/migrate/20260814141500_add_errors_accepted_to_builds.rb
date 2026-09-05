class AddErrorsAcceptedToBuilds < ActiveRecord::Migration[8.0]
  def change
    add_column :builds, :errors_accepted, :boolean, default: false, null: false
  end
end
