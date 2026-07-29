require "test_helper"

class PublishBuildFilesJobTest < ActiveJob::TestCase
  test "does nothing against the Disk service used in test/development" do
    build = builds(:one)
    file = build.build_files.create!(relative_path: "pdf.pdf")
    file.blob.attach(io: StringIO.new("%PDF-1.4"), filename: "pdf.pdf", content_type: "application/pdf")

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
end
