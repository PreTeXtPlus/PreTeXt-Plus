class SetDefaultCommonDocinfoOnUsers < ActiveRecord::Migration[8.1]
  DEFAULT_DOCINFO = <<~XML
    <docinfo>
      <brandlogo source="icon.svg" />
    </docinfo>
  XML

  def up
    change_column_default :users, :common_docinfo, from: nil, to: DEFAULT_DOCINFO

    quoted_default = connection.quote(DEFAULT_DOCINFO)
    execute <<~SQL
      UPDATE users
      SET common_docinfo = #{quoted_default}
      WHERE common_docinfo IS NULL
    SQL
  end

  def down
    change_column_default :users, :common_docinfo, from: DEFAULT_DOCINFO, to: nil
  end
end
