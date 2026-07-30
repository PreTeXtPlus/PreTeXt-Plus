# When PublishBuildFilesJob finished flipping this build's stored files world-readable.
# PublishedController reads it (through Build#files_public?) to decide whether it may
# hand a reader a plain cdn.pretext.plus URL instead of a signed one: the flip happens
# in a background job, so between publishing a target and that job landing -- or forever,
# if the storage provider refuses -- the public URL would 404. Recording it is what makes
# the CDN redirect a consequence of the ACL rather than a bet on it.
#
# Per build, not per target: each new build attaches new blobs, which start private.
#
# Deliberately left null for builds that predate this column, including ones already made
# public by an earlier deploy or by cdn:backfill_public_builds. Null only costs a signed
# redirect, which works either way, and the next build sets it honestly.
class AddFilesPublicAtToBuilds < ActiveRecord::Migration[8.1]
  def change
    add_column :builds, :files_public_at, :datetime
  end
end
