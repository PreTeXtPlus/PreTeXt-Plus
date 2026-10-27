class CreateMaintenanceWindows < ActiveRecord::Migration[8.1]
  def change
    create_table :maintenance_windows, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.datetime :starts_at, null: false
      t.string :note
      t.timestamps
    end
    add_index :maintenance_windows, :starts_at
  end
end
