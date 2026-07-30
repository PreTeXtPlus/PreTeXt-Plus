require "test_helper"

class PublishBuildFilesJobTest < ActiveJob::TestCase
  test "does nothing against the Disk service used in test/development" do
    build = builds(:one)
    file = attach_pdf(build)

    # The :test service (Disk) has no ACL concept -- this only proves the whole
    # find_each loop runs without raising. See below for what it does on a service
    # that has one.
    PublishBuildFilesJob.perform_now(build)

    assert file.reload.blob.attached?
  end

  test "flips a blob's object to public-read on a service that has one" do
    acl = Minitest::Mock.new
    acl.expect(:put, nil, acl: "public-read")
    object = Minitest::Mock.new
    object.expect(:acl, acl)
    bucket = Minitest::Mock.new
    bucket.expect(:object, object, [ "some-key" ])
    fake_service = Struct.new(:bucket).new(bucket)
    fake_blob = Struct.new(:service, :key).new(fake_service, "some-key")

    PublishBuildFilesJob.new.send(:make_public, fake_blob)

    assert acl.verify
    assert object.verify
    assert bucket.verify
  end

  # The stamp is the whole point of the job as far as anything downstream is concerned:
  # PublishedController will not hand out a CDN URL for a build without it.
  test "stamps the build once every file is through" do
    build = builds(:one)
    attach_pdf(build)
    assert_not build.files_public?

    PublishBuildFilesJob.perform_now(build)

    assert build.reload.files_public?
  end

  # A storage provider that refuses must leave the build looking private, or readers get
  # public URLs for objects that never became public.
  test "a failure partway leaves the build unstamped" do
    build = builds(:one)
    attach_pdf(build)

    job = PublishBuildFilesJob.new
    job.define_singleton_method(:make_public) { |_blob| raise "the storage provider said no" }

    assert_raises(RuntimeError) { job.perform(build) }
    assert_not build.reload.files_public?
  end

  private

    def attach_pdf(build)
      file = build.build_files.create!(relative_path: "pdf.pdf")
      file.blob.attach(io: StringIO.new("%PDF-1.4"), filename: "pdf.pdf", content_type: "application/pdf")
      file
    end
end
