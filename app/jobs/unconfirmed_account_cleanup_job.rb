# frozen_string_literal: true

# Deletes sign-ups whose email address was never confirmed and which hold nothing --
# see User.stale_unconfirmed for exactly who qualifies. These are overwhelmingly bots
# registering other people's addresses; the owner of such an address never asked for an
# account, and someone who simply forgot to confirm can register again.
class UnconfirmedAccountCleanupJob < ApplicationJob
  queue_as :default

  def perform
    User.stale_unconfirmed.find_each do |user|
      user.destroy!
    rescue StandardError => e
      # One account that will not delete must not stop the rest; it is retried next run.
      Honeybadger.notify(e, context: { user_id: user.id })
      Rails.logger.error("[unconfirmed account cleanup] failed for user #{user.id}: #{e.message}")
    end
  end
end
