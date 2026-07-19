class MigrateLibraryAndProjectAssetsToAssets < ActiveRecord::Migration[8.1]
  class MigrationLibraryAsset < ActiveRecord::Base
    self.table_name = "library_assets"
  end

  class MigrationProjectAsset < ActiveRecord::Base
    self.table_name = "project_assets"
  end

  class MigrationProject < ActiveRecord::Base
    self.table_name = "projects"
  end

  class MigrationDivision < ActiveRecord::Base
    self.table_name = "divisions"
  end

  class MigrationAsset < ActiveRecord::Base
    self.table_name = "assets"
  end

  class MigrationAttachment < ActiveRecord::Base
    self.table_name = "active_storage_attachments"
  end

  def up
    now = Time.current
    holding_projects_by_user_id = {}

    MigrationLibraryAsset.find_each do |la|
      memberships = MigrationProjectAsset
        .where(library_asset_id: la.id)
        .order(:created_at, :id)
        .to_a
      attachment = MigrationAttachment.find_by(
        record_type: "LibraryAsset", record_id: la.id, name: "file"
      )

      if memberships.empty?
        holding_project = holding_projects_by_user_id[la.user_id] ||= create_holding_project(la.user_id, now)
        ref = orphan_ref(la.id)
        create_asset(id: la.id, project_id: holding_project.id, ref: ref, la: la)
        attachment&.update!(record_type: "Asset")
        append_asset_reference(holding_project.id, ref)
      else
        primary, *extras = memberships

        # The common case: reuse the LibraryAsset's own id as the Asset's id,
        # so the attachment row just needs its record_type flipped -- no
        # record_id remap, no re-upload.
        create_asset(id: la.id, project_id: primary.project_id, ref: primary.ref, la: la)
        attachment&.update!(record_type: "Asset")

        # A LibraryAsset could legally belong to more than one project
        # (has_many :library_assets, through: :project_assets was many-to-many).
        # Since an Asset now belongs to exactly one project, every membership
        # beyond the first becomes its own new Asset row with a fresh id,
        # sharing the same underlying blob (not re-uploading bytes) via a new
        # active_storage_attachments row.
        extras.each do |pa|
          new_id = SecureRandom.uuid
          create_asset(id: new_id, project_id: pa.project_id, ref: pa.ref, la: la)
          next unless attachment

          MigrationAttachment.create!(
            record_type: "Asset",
            record_id: new_id,
            name: "file",
            blob_id: attachment.blob_id,
            created_at: now
          )
        end
      end
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end

  private

  def create_asset(id:, project_id:, ref:, la:)
    MigrationAsset.create!(
      id: id,
      project_id: project_id,
      ref: ref,
      kind: la.kind,
      source: la.source,
      short_description: la.short_description,
      description: la.description,
      title: la.title,
      created_at: la.created_at,
      updated_at: la.updated_at
    )
  end

  # A UUID-derived ref: always matches REF_REGEX (starts with a letter,
  # remaining chars are hex digits, which are all letters/digits) and is
  # guaranteed unique within the fresh holding project without needing a
  # collision-checking loop, since la.id is itself a unique UUID.
  def orphan_ref(library_asset_id)
    "asset_#{library_asset_id.delete('-')}"
  end

  def create_holding_project(user_id, now)
    project = MigrationProject.create!(
      user_id: user_id,
      title: "Imported Assets",
      document_type: 0, # article
      use_common_docinfo: false,
      created_at: now,
      updated_at: now
    )
    MigrationDivision.create!(
      project_id: project.id,
      ref: "document",
      is_root: true,
      source_format: 0, # pretext
      source: holding_project_root_source,
      created_at: now,
      updated_at: now
    )
    project
  end

  # A minimal root division so the per-user holding project (created above
  # for orphaned assets) is a normal, openable project rather than a broken
  # one with no root. Each moved-in asset is referenced with a <plus:image>
  # tag -- the web-editor's documented syntax for placing an asset by ref --
  # so every recovered asset shows up in the document instead of being
  # orphaned a second time inside an unreferenced project.
  def holding_project_root_source
    @holding_project_root_source ||= +(<<~XML)
      <article xml:id="document">
        <title>Imported Assets</title>
        <p>
          This project was created automatically to hold image/authored assets
          that existed in your library but weren't part of any project at the
          time PreTeXt.Plus merged its asset models. Feel free to rename this
          project, move these assets' content elsewhere, or delete it.
        </p>
      </article>
    XML
  end

  # Inserts a <plus:image ref="..."/> for the given ref just before the
  # closing </article> tag of the holding project's root division source, so
  # every asset moved into it ends up referenced in the document.
  def append_asset_reference(project_id, ref)
    division = MigrationDivision.find_by(project_id: project_id, is_root: true)
    return unless division

    updated_source = division.source.sub(
      "</article>", "    <p><plus:image ref=\"#{ref}\"/></p>\n</article>"
    )
    division.update!(source: updated_source)
  end
end
