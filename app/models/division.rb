class Division < ApplicationRecord
  belongs_to :project
  enum :source_format, { pretext: 0, latex: 1, markdown: 2 }, default: :pretext, suffix: true, validate: true
end
