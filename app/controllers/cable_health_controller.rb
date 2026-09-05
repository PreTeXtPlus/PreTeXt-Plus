# Liveness for the *relay*, as distinct from liveness for the app.
#
# `/up` answers "is this process serving HTTP", which stayed true throughout the
# August 2026 collaboration outage and is exactly why nothing alerted. What breaks
# collaborative editing is narrower: solid_cable's listener thread. It polls the
# separate cable database (see config/cable.yml and the `cable` entry in
# database.yml) and hands broadcasts to subscribers, and it is startlingly easy to
# lose --
#
#   @thread = Thread.new do
#     begin
#       listen
#     rescue *CONNECTION_ERRORS   # only ConnectionFailed/Timeout/NotEstablished
#       retry if retry_connecting? # ...and only a bounded number of times
#     end
#   end
#
# -- so any error that isn't one of those three kills it outright, and one of those
# three kills it too once the bounded retries are spent. The thread does not come
# back. The process goes on serving every HTTP request perfectly while delivering no
# broadcast to anyone, forever, until it is restarted. Which is why a redeploy
# "fixed" an outage that no deploy had caused.
#
# This endpoint publishes a token through the configured pubsub and waits to hear it
# back, so it fails exactly when that thread is gone.
#
# Two things to know when reading its result:
#
# * It reports on *the process that served the request*. Under multiple Puma workers
#   a monitor will land on them round-robin, so one wedged worker shows up as an
#   intermittent failure, not a steady one. Treat any failure as real.
# * It is deliberately not part of `/up`. A container orchestrator restarting the app
#   because the cable database blipped would be a worse outage than the one this
#   catches; point a monitor at it and alert, don't wire it to a liveness probe.
class CableHealthController < ApplicationController
  allow_unauthenticated_access

  # A round trip is a database write, a poll (0.1s in production) and a callback, so
  # this is roughly two orders of magnitude more than a healthy relay needs. It is a
  # ceiling on how long a wedged relay ties up this thread, not a target.
  TIMEOUT = 3.seconds

  # The request holds a thread for up to TIMEOUT, so it is worth a ceiling even
  # though it is only ever meant to be called by a monitor every minute or so.
  rate_limit to: 60, within: 1.minute, only: :show, with: -> { head :too_many_requests }

  def show
    silent_for = round_trip

    if silent_for
      render plain: "ok (relay round-tripped in #{(silent_for * 1000).round}ms)"
    else
      # Notified from here rather than left to the monitor because this is the one
      # place that knows *which* process failed, and that is most of the diagnosis.
      Honeybadger.notify(
        "Collaborative editing relay is not delivering broadcasts",
        error_class: "Collab::RelayDown",
        context: {
          timeout_seconds: TIMEOUT.to_i,
          adapter: ActionCable.server.config.cable&.dig("adapter"),
          pid: Process.pid,
          hostname: Socket.gethostname
        }
      )
      render plain: "cable relay did not round-trip within #{TIMEOUT.to_i}s", status: :service_unavailable
    end
  end

  private

    # Seconds the round trip took, or nil if the token never came back.
    def round_trip
      token = SecureRandom.hex(16)
      channel = "cable-health/#{token}"
      pubsub = ActionCable.server.pubsub

      received = Thread::Queue.new
      subscribed = Thread::Queue.new
      callback = ->(message) { received.push(message) }

      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      begin
        # Broadcasting before the subscription is live would race, and would fail
        # this check on a *healthy* relay -- the success callback is what makes the
        # negative result mean something.
        pubsub.subscribe(channel, callback, -> { subscribed.push(true) })
        return nil unless subscribed.pop(timeout: TIMEOUT)

        pubsub.broadcast(channel, token)
        return nil unless received.pop(timeout: TIMEOUT) == token

        Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
      ensure
        # A per-request channel that outlived its request would leave the listener
        # polling for a token nobody is waiting for, once per health check, forever.
        pubsub.unsubscribe(channel, callback)
      end
    rescue StandardError => error
      # A raise here is itself a red flag (the adapter could not even be reached),
      # and is reported as the failure it is rather than as a 500.
      Rails.logger.error("[cable-health] #{error.class}: #{error.message}")
      nil
    end
end
