require "test_helper"

class AssetTest < ActiveSupport::TestCase
  test "url returns the attached file's url when a file is attached" do
    asset = assets(:image_one)
    asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png",
      content_type: "image/png"
    )

    ActiveStorage::Current.url_options = { host: "example.com" }
    travel_to Time.current do
      assert_equal asset.file.url(expires_in: 1.hour), asset.url
    end
  end

  test "url is the placeholder image when no file is attached" do
    asset = assets(:authored_one)

    assert_equal "/image-not-found.svg", asset.url
  end

  test "ref must be unique among divisions in the same project" do
    project = projects(:one)
    Division.create!(project: project, ref: "taken_ref", source_format: :pretext, is_root: false)

    asset = Asset.new(project: project, ref: "taken_ref", kind: :file)

    assert_not asset.valid?
    assert_includes asset.errors[:ref], "has already been taken"
  end

  test "full_dup gives the copy an independent asset row that shares the original's file blob" do
    project = projects(:one)
    asset = assets(:image_one)
    asset.file.attach(
      io: File.open(Rails.root.join("test/fixtures/files/test_image.png")),
      filename: "test_image.png", content_type: "image/png"
    )

    copy = project.full_dup(users(:two))
    copy.save!

    copied_asset = copy.assets.find_by!(ref: asset.ref)
    assert_not_equal asset.id, copied_asset.id
    assert copied_asset.file.attached?
    assert_equal asset.file.blob, copied_asset.file.blob
  end

  test "unsubscribed owner is capped at 100 total assets across all their projects" do
    owner = users(:one)
    project = Project.create!(user: owner, title: "Quota project")
    remaining = owner.asset_quota - owner.assets.count
    remaining.times { |n| project.assets.create!(ref: "cap-#{n}", kind: :authored, title: "A#{n}") }

    assert_equal owner.asset_quota, owner.reload.assets.count

    over = project.assets.build(ref: "cap-over", kind: :authored, title: "Over")
    assert_not over.valid?
    assert_match(/limit/i, over.errors[:base].to_sentence)
  end

  test "subscribed owner is not capped by asset count" do
    owner = users(:subscribed)
    project = Project.create!(user: owner, title: "Quota project")
    101.times { |n| project.assets.create!(ref: "sub-#{n}", kind: :authored, title: "S#{n}") }

    assert_equal 101, project.assets.count
  end

  test "asset quota follows the project owner's plan, not the collaborator's" do
    owner = users(:one) # unsubscribed
    project = Project.create!(user: owner, title: "Quota project")
    remaining = owner.asset_quota - owner.assets.count
    remaining.times { |n| project.assets.create!(ref: "collab-#{n}", kind: :authored, title: "A#{n}") }

    # users(:subscribed) is an unrelated, subscribed account -- their own plan
    # must not lift the cap on someone else's project.
    over = project.assets.build(ref: "collab-over", kind: :authored, title: "Collab Over")
    assert_not over.valid?
  end

  test "asset quota is not enforced on existing rows (grandfathering)" do
    assert assets(:authored_one).valid?
  end
end
