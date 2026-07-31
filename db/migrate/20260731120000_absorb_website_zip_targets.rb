# `website_zip` is gone from Target::Catalog -- a website target already offers its whole
# output as a zip, so the separate kind bought nothing.
#
# The rows have to move with it. A target whose kind the catalog no longer knows has no
# `emits`, so it contributes a <target> element with no @format, and project.ptx is
# invalid -- which fails every build of that project, not just that one output. It would
# also fail its own validation the next time anything saved it.
#
# Converting to `website` keeps the slug, and so keeps any published URL working. What it
# does not do is change the artifact already built: `entry_path` still points at the zip
# that build produced, which is right until the next build replaces it with a site.
#
# update_all rather than update!: the rows are invalid by definition at this point (the
# catalog no longer offers their kind), so validations would refuse the very change that
# makes them valid again.
class AbsorbWebsiteZipTargets < ActiveRecord::Migration[8.1]
  def up
    Target.where(kind: "website_zip").update_all(kind: "website", updated_at: Time.current)
  end

  # Deliberately irreversible: the kind no longer exists to go back to, and nothing
  # records which websites used to be zips.
  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
