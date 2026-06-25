Devise.setup do |config|
  config.mailer_sender = "signin@mailer.pretext.plus"

  require "devise/orm/active_record"

  config.case_insensitive_keys = [ :email ]
  config.strip_whitespace_keys = [ :email ]
  config.skip_session_storage = [ :http_auth ]
  config.stretches = Rails.env.test? ? 1 : 12
  config.reconfirmable = true
  config.expire_all_remember_me_on_sign_out = true
  config.password_length = 6..128
  config.email_regexp = /\A[^@\s]+@[^@\s]+\z/
  config.reset_password_within = 6.hours
  config.sign_out_via = :delete

  config.responder.error_status = :unprocessable_entity
  config.responder.redirect_status = :see_other

  # Inherit our ApplicationMailer for Devise emails so they use the same
  # delivery method (Postmark) and layout as other transactional emails.
  config.parent_mailer = "ApplicationMailer"

  config.allow_unconfirmed_access_for = 3.days
end
