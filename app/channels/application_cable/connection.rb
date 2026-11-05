module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      self.current_user = find_current_user || reject_unauthorized_connection
    end

    private

    # An account awaiting deletion has no editor to connect from -- see
    # ApplicationController#redirect_pending_deletion.
    def find_current_user
      user = env["warden"].user
      user unless user&.pending_deletion?
    end
  end
end
