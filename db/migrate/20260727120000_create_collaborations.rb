class CreateCollaborations < ActiveRecord::Migration[8.1]
  def change
    create_table :collaborations, id: :uuid do |t|
      t.references :project, type: :uuid, null: false, foreign_key: true
      # Null while the invite is pending (no matching account yet); set when a
      # confirmed user claims the invitation.
      t.references :user, type: :uuid, null: true, foreign_key: true
      t.string :invited_email, null: false
      t.datetime :accepted_at

      t.timestamps
    end

    add_index :collaborations, [ :project_id, :invited_email ], unique: true
  end
end
