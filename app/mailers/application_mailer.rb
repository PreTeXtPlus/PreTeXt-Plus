class ApplicationMailer < ActionMailer::Base
  default from: "info@mailer.pretext.plus"
  default reply_to: "support@pretext.plus"
  layout "mailer"
  before_action :attach_logo

  private

  def attach_logo
    attachments.inline["logo.svg"] = File.read(Rails.root.join("app/assets/images/logo.svg"))
  end
end
