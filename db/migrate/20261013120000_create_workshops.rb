class CreateWorkshops < ActiveRecord::Migration[8.1]
  def change
    create_table :workshops, id: :uuid, default: -> { "gen_random_uuid()" } do |t|
      t.string :title, null: false
      t.datetime :start_time, null: false
      t.string :link, null: false
      t.timestamps
    end
    add_index :workshops, :start_time
  end
end
