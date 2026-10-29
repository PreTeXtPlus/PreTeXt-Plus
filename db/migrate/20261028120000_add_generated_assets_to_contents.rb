# A generated asset (Content#kind "generated_asset") is authored source for a
# `generator` ("prefigure") plus the picture the editor rendered from it, stored as
# its file. `output_source_digest` is the sha256 of the render input (source + the
# docinfo elements the generator reads) that picture was built from, so a later
# edit marks it stale rather than showing a picture that no longer matches. See
# docs/generated-assets-plan.md.
class AddGeneratedAssetsToContents < ActiveRecord::Migration[8.1]
  def change
    add_column :contents, :generator, :string
    add_column :contents, :output_source_digest, :string
  end
end
