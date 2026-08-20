class Snippet < ApplicationRecord
  include HasUniqueRef
  ref_sibling_classes "Division", "Asset"

  # See Division: a build consumes snippets too, so changing one makes built targets stale.
  belongs_to :project, touch: :source_updated_at
  enum :source_format, { pretext: 0, latex: 1, markdown: 2 }, default: :pretext, suffix: true, validate: true
end
