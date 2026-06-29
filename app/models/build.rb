class Build < ApplicationRecord
  belongs_to :project
  has_one_attached :zip
  has_many :build_files, dependent: :destroy

  def file_at(path)
    path.blank? ?
      paths = [ "index.html" ] :
      paths = [ path, "#{path}.html", "#{path}/index.html" ]
    build_files.find_by(relative_path: paths)
  end
end
