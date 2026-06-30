class Build < ApplicationRecord
  belongs_to :project
  has_one_attached :zip
  has_many :build_files, dependent: :destroy

  enum :status, { pending: 0, in_progress: 1, success: 2, failed: 3 }, default: :pending, validate: true

  def file_at(path)
    path.blank? ?
      paths = [ "index.html" ] :
      paths = [ path, path.sub(/\.[^.]+\z/, ""), "#{path}.html", "#{path}/index.html" ]
    build_files.find_by(relative_path: paths)
  end
end
