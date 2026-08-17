class AddDictionaryWordsToProjects < ActiveRecord::Migration[8.1]
  def change
    add_column :projects, :dictionary_words, :string, array: true, default: [], null: false
  end
end
