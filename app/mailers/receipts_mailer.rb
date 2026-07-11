# Renders Pay's "receipt" email with our own template while
# falling back to Pay::UserMailer's built-in templates for every
# other Pay:: email (refund, subscription_renewing, etc.)
class ReceiptsMailer < Pay::UserMailer
  default template_path: "pay/user_mailer"

  def receipt
    if params[:pay_charge].respond_to? :receipt
      attachments[params[:pay_charge].filename] = params[:pay_charge].receipt
    end

    mail mail_arguments.merge(template_path: "receipts_mailer")
  end

  private

  # Pay's subject translations live under "pay.user_mailer.*", keyed by
  # Pay::UserMailer's own mailer_name. Use that scope here too, since our
  # mailer_name ("receipts_mailer") wouldn't otherwise match those keys.
  def default_i18n_subject(interpolations = {})
    I18n.t(:subject, **interpolations, scope: [ "pay.user_mailer", action_name ], default: action_name.humanize)
  end
end
