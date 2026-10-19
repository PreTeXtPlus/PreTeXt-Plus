# A generated asset (Asset#kind "generated") is authored source plus the files PreTeXt
# would generate from it. `generator` names the tool ("prefigure"); `output_source_digest`
# is the sha256 of the render input (source + docinfo macros + preamble) the attached
# outputs were built from, so a later edit marks them stale rather than shipping a
# picture that no longer matches the source. See docs/generated-assets-plan.md.
class AddGeneratedAssets < ActiveRecord::Migration[8.1]
  def change
    add_column :assets, :generator, :string
    add_column :assets, :output_source_digest, :string
  end
end
