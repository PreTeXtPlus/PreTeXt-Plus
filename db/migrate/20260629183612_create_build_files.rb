class CreateBuildFiles < ActiveRecord::Migration[8.1]
  def change
    create_table :build_files, id: :uuid do |t|
      t.references :build, null: false, foreign_key: true, type: :uuid
      t.string :relative_path, null: false

      t.timestamps
    end
    add_index :build_files, [ :build_id, :relative_path ], unique: true
  end
end
