# A generated asset -- an authored asset whose source_format is a generator's, such
# as "prefigure" (an integer enum value, so no column change) -- may store the
# picture the editor rendered from it as its file. `preview_input_digest` is the
# sha256 of the render input (source + the docinfo elements the generator reads)
# that picture was built from, so a later edit marks it stale rather than showing
# a picture that no longer matches. See docs/generated-assets-plan.md.
class AddPreviewInputDigestToContents < ActiveRecord::Migration[8.1]
  def change
    add_column :contents, :preview_input_digest, :string
  end
end
