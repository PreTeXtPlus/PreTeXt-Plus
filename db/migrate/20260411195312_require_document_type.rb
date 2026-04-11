class RequireDocumentType < ActiveRecord::Migration[8.1]
  def change
    change_column_default :projects, :document_type, from: nil, to: 0
    Project.where(document_type: nil).update_all(document_type: 0)
    change_column_null :projects, :document_type, false
  end
end
