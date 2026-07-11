class AddRemoteStatusUrlAndLogToBuilds < ActiveRecord::Migration[8.1]
  def change
    add_column :builds, :remote_status_url, :string
    add_column :builds, :log, :text
  end
end
