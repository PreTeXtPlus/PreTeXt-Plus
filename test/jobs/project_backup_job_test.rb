require "test_helper"

class ProjectBackupJobTest < ActiveJob::TestCase
  test "backs up recently edited projects of subscribers only" do
    subscribed = projects(:team)
    unsubscribed = projects(:one)
    subscribed.touch
    unsubscribed.touch

    ProjectBackupJob.perform_now

    assert_equal 1, subscribed.backups.count
    assert_empty unsubscribed.backups
  end

  test "skips projects not edited lately" do
    project = projects(:team)
    project.update_columns(updated_at: 1.hour.ago, source_updated_at: 1.hour.ago)

    ProjectBackupJob.perform_now

    assert_empty project.backups
  end

  test "does not back up again until the project changes" do
    project = projects(:team)
    project.touch
    ProjectBackupJob.perform_now
    travel 10.minutes

    ProjectBackupJob.perform_now

    assert_equal 1, project.backups.count
  end
end
