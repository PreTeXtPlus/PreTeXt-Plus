require "test_helper"

class ProjectBackupTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @project = projects(:one)
    # Admins have subscriber benefits without fixture subscriptions.
    @project.user.update!(admin: true)
  end

  def edit!
    @project.update!(title: "#{@project.title}!")
  end

  def tiers
    @project.backups.reload.to_h { |backup| [ backup.backup_tier.to_sym, backup ] }
  end

  test "first backup is a hidden copy of the project in the recent slot" do
    backup = ProjectBackup.new(@project).rotate!

    assert backup.backup?
    assert backup.backup_recent?
    assert_equal @project.id, backup.backup_of_id
    assert_equal @project.title, backup.title
    assert_equal @project.divisions.pluck(:ref).sort, backup.divisions.pluck(:ref).sort
    assert_equal @project.assets.pluck(:ref).sort, backup.assets.pluck(:ref).sort
    assert_not_includes Project.all, backup
    assert_not_includes @project.user.projects, backup
    assert_raises(ActiveRecord::RecordNotFound) { Project.find(backup.id) }
  end

  test "does nothing when the project has not changed since its last backup" do
    ProjectBackup.new(@project).rotate!
    travel 11.minutes

    assert_nil ProjectBackup.new(@project.reload).rotate!
    assert_equal 1, @project.backups.count
  end

  test "does nothing for a project whose owner is not a subscriber" do
    @project.user.update!(admin: false)

    assert_nil ProjectBackup.new(@project).rotate!
    assert_empty @project.backups
  end

  test "never backs up a backup" do
    backup = ProjectBackup.new(@project).rotate!

    assert_nil ProjectBackup.new(backup).rotate!
  end

  test "rotates through at most four slots, promoting by age" do
    taken = []
    5.times do
      edit!
      taken << ProjectBackup.new(@project).rotate!.backed_up_at
      travel 10.minutes
    end

    assert_equal %i[ recent hourly three_hourly daily ], tiers.keys
    # The fifth snapshot evicted the youngest unaged backup, not the oldest.
    assert_equal taken[0], tiers[:daily].backed_up_at
    assert_equal taken[4], tiers[:recent].backed_up_at

    # An hour on, the hourly backup has outgrown its slot and the recent one
    # takes it over; the three-hourly one is still under three hours and stays.
    travel 1.hour
    edit!
    ProjectBackup.new(@project).rotate!
    assert_equal taken[0], tiers[:daily].backed_up_at
    assert_equal taken[1], tiers[:three_hourly].backed_up_at
    assert_equal taken[4], tiers[:hourly].backed_up_at
    assert_equal 4, @project.backups.count
  end

  test "the daily slot is only replaced once it is a day old" do
    4.times do
      edit!
      ProjectBackup.new(@project).rotate!
      travel 10.minutes
    end
    oldest = tiers[:daily]

    travel 20.hours
    edit!
    ProjectBackup.new(@project).rotate!
    assert_equal oldest, tiers[:daily]

    travel 5.hours
    edit!
    ProjectBackup.new(@project).rotate!
    assert_not_equal oldest, tiers[:daily]
    assert_not Project.unscoped.exists?(oldest.id)
  end

  test "backing up assets ignores the asset quota" do
    user = @project.user
    user.define_singleton_method(:has_subscriber_benefits?) { true }
    user.define_singleton_method(:asset_quota) { 0 }
    @project.user = user

    backup = ProjectBackup.new(@project).rotate!
    assert_equal @project.assets.count, backup.assets.count
  end

  test "destroying a backup leaves the project's asset files in place" do
    backup = ProjectBackup.new(@project).rotate!
    blob = assets(:image_one).file.blob

    perform_enqueued_jobs { backup.destroy! }

    assert ActiveStorage::Blob.exists?(blob.id)
    assert assets(:image_one).reload.file.attached?
  end

  test "destroying the project destroys its backups" do
    backup = ProjectBackup.new(@project).rotate!

    @project.destroy!

    assert_not Project.unscoped.exists?(backup.id)
  end

  test "a restored copy of a backup is an ordinary project" do
    backup = ProjectBackup.new(@project).rotate!
    copy = backup.full_dup(@project.user)
    copy.save!

    assert_not copy.backup?
    assert_includes Project.all, copy
  end
end
