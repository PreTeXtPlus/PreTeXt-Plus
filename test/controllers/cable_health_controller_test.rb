require "test_helper"

class CableHealthControllerTest < ActionDispatch::IntegrationTest
  test "reports ok when a broadcast round-trips through the relay" do
    get cable_health_check_url

    assert_response :success
    assert_match(/\Aok /, response.body)
  end

  test "does not require a signed-in user, so a monitor can call it" do
    get cable_health_check_url

    assert_response :success
  end

  test "reports service unavailable and notifies when the relay never delivers" do
    notified = capture_notifications do
      # A pubsub that accepts the subscription and then swallows the broadcast is
      # exactly the shape of the failure this exists to catch: solid_cable's
      # listener thread gone, everything else about the process still healthy.
      ActionCable.server.stub(:pubsub, DeafPubsub.new) do
        get cable_health_check_url
      end
    end

    assert_response :service_unavailable
    assert_equal 1, notified.size
    assert_equal "Collab::RelayDown", notified.first[:error_class]
  end

  test "reports service unavailable when the subscription itself never confirms" do
    notified = capture_notifications do
      ActionCable.server.stub(:pubsub, UnreachablePubsub.new) do
        get cable_health_check_url
      end
    end

    assert_response :service_unavailable
    assert_equal 1, notified.size
  end

  test "reports service unavailable rather than raising when the adapter errors" do
    notified = capture_notifications do
      ActionCable.server.stub(:pubsub, RaisingPubsub.new) do
        get cable_health_check_url
      end
    end

    assert_response :service_unavailable
    assert_equal 1, notified.size
  end

  # Confirms the subscription is torn down however the check ends -- a per-request
  # channel that leaked would leave the listener polling for it forever, once per
  # health check.
  test "unsubscribes its temporary channel on both success and failure" do
    tracker = TrackingPubsub.new
    ActionCable.server.stub(:pubsub, tracker) do
      get cable_health_check_url
    end
    assert_equal tracker.subscribed, tracker.unsubscribed

    deaf = DeafPubsub.new
    capture_notifications do
      ActionCable.server.stub(:pubsub, deaf) do
        get cable_health_check_url
      end
    end
    assert_equal deaf.subscribed, deaf.unsubscribed
  end

  # Records subscribe/unsubscribe pairs; delivers normally otherwise.
  class TrackingPubsub
    attr_reader :subscribed, :unsubscribed

    def initialize
      @subscribed = []
      @unsubscribed = []
    end

    def subscribe(channel, callback, success_callback = nil)
      @subscribed << channel
      @callbacks ||= {}
      @callbacks[channel] = callback
      success_callback&.call
    end

    def unsubscribe(channel, _callback)
      @unsubscribed << channel
    end

    def broadcast(channel, payload)
      @callbacks[channel]&.call(payload)
    end
  end

  # Subscribes fine, never delivers.
  class DeafPubsub < TrackingPubsub
    def broadcast(_channel, _payload)
    end
  end

  # Never confirms the subscription.
  class UnreachablePubsub < TrackingPubsub
    def subscribe(channel, _callback, _success_callback = nil)
      @subscribed << channel
    end
  end

  # Cannot be reached at all.
  class RaisingPubsub < TrackingPubsub
    def subscribe(*)
      raise ActiveRecord::ConnectionNotEstablished, "cable database is gone"
    end
  end

  private

    def capture_notifications
      captured = []
      Honeybadger.stub(:notify, ->(message, **options) { captured << options.merge(message: message) }) do
        yield
      end
      captured
    end
end
