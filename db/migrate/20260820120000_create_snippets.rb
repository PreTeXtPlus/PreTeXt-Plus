class CreateSnippets < ActiveRecord::Migration[8.1]
  def change
    create_table :snippets, id: :uuid do |t|
      t.references :project, null: false, foreign_key: true, type: :uuid
      t.string :ref
      t.text :source
      t.integer :source_format, default: 0, null: false

      t.timestamps
    end
  end
end
