# Flips a build's stored files to world-readable, so PublishedController can send a
# plain cdn.pretext.plus URL instead of a signed one -- see ServesBuildFiles and
# Target#make_current_build_public!, the only caller.
#
# A network call per file, so this runs as a job rather than inline in the model
# callbacks and controller action that decide a build should be public -- an S3
# hiccup here must not break an unrelated build transition or the publish request.
class PublishBuildFilesJob < ApplicationJob
  queue_as :default

  def perform(build)
    build.build_files.with_attached_blob.find_each do |build_file|
      make_public(build_file.blob) if build_file.blob.attached?
    end
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
