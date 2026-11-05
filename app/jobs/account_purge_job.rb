# frozen_string_literal: true

# Permanently deletes accounts whose deletion grace period has run out (see
# User#pending_deletion?). Destroying the user cascades to every project it owns --
# contents and their attached files, targets, builds and their files, backups,
# collaborations -- and Pay cancels any subscription of theirs still active.
class AccountPurgeJob < ApplicationJob
  queue_as :default

  def perform
    User.due_for_purge.find_each do |user|
      user.destroy!
    rescue StandardError => e
      # One account that will not delete must not stop the rest; it is retried next run.
      Honeybadger.notify(e, context: { user_id: user.id })
      Rails.logger.error("[account purge] failed for user #{user.id}: #{e.message}")
    end
  end
end
