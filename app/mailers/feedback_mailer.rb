class FeedbackMailer < ApplicationMailer
  def feedback_submission(feedback_data)
    @context = feedback_data[:context]
    @message = feedback_data[:message]
    @email = feedback_data[:email]
    @project_url = feedback_data[:project_url]
    @submitted_at = feedback_data[:submitted_at]
    @user = feedback_data[:user]

    mail(
      to: "feedback@pretext.plus",
      subject: "PreTeXt.Plus Feedback: #{@context}",
      from: "feedbackform@mailer.pretext.plus",
      reply_to: @email
    )
  end

  # A conversion shared from the new-project wizard or the editor's Import
  # dialog (see ProjectsController#import_share). The original file and the
  # converted PreTeXt ride as attachments, so either can be fed straight back in.
  def import_share(share)
    @user = share[:user]
    @engine = share[:engine]
    @context = share[:context]
    @error = share[:error]
    @project_url = share[:project_url]
    @file_name = share[:file_name]
    @file_size = share[:file_size]
    @file_attached = share[:file_data].present?
    @pretext_name = "#{File.basename(@file_name, ".*")}.ptx"
    @pretext_size = share[:pretext_size].to_i
    @pretext_attached = share[:pretext].present?

    if @file_attached
      attachments[@file_name] = { mime_type: share[:file_type], content: share[:file_data].unpack1("m0") }
    end
    if @pretext_attached
      attachments[@pretext_name] = { mime_type: "application/xml", content: share[:pretext] }
    end

    mail(
      to: "feedback@pretext.plus",
      subject: "PreTeXt.Plus import #{@error ? "failure" : "conversion"}: #{@file_name}",
      from: "feedbackform@mailer.pretext.plus"
    )
  end
end
