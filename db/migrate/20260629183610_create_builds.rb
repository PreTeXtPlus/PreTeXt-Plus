class CreateBuilds < ActiveRecord::Migration[8.1]
  def change
    create_table :builds, id: :uuid do |t|
      t.references :project, null: false, foreign_key: true, type: :uuid

      t.timestamps
    end
  end
end
