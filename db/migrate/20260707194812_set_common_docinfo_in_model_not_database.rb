class SetCommonDocinfoInModelNotDatabase < ActiveRecord::Migration[8.1]
  def change
    change_column_default :users, :common_docinfo, from: "<docinfo>\n  <brandlogo source=\"icon.svg\" />\n</docinfo>\n", to: nil
  end
end
