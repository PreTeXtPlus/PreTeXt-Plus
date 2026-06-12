module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      self.current_user = find_current_user || reject_unauthorized_connection
    end

    private

    def find_current_user
      env["warden"].user
    end
  end
end
