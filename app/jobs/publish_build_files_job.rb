# Flips a build's stored files to world-readable, so PublishedController can send a
# plain cdn.pretext.plus URL instead of a signed one -- see ServesBuildFiles and
# Target#make_current_build_public!, the only caller.
#
# A network call per file, so this runs as a job rather than inline in the model
# callbacks and controller action that decide a build should be public -- an S3
# hiccup here must not break an unrelated build transition or the publish request.
class PublishBuildFilesJob < ApplicationJob
  queue_as :default

  # The stamp goes on only after every file is through, and is what PublishedController
  # checks before handing out a cdn.pretext.plus URL. A raise partway leaves it null, so
  # readers keep getting signed URLs -- which resolve whatever the ACL says -- instead of
  # public ones pointing at objects that are still private.
  #
  # update_column rather than update!: pure bookkeeping, with no reason to bump the row's
  # updated_at or wake the broadcasts that hang off a build changing.
  def perform(build)
    build.build_files.with_attached_blob.find_each do |build_file|
      make_public(build_file.blob) if build_file.blob.attached?
    end

    build.update_column(:files_public_at, Time.current)
  end

  private

    # The :test and :local services are Disk, which has no ACL concept -- nothing to
    # do in development or test, where cdn_url_options is also unset.
    def make_public(blob)
      service = blob.service
      return unless service.respond_to?(:bucket)

      service.bucket.object(blob.key).acl.put(acl: "public-read")
    end
end
