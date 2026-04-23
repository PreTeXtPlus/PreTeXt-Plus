class FeedbackMailer < ApplicationMailer
  def feedback_submission(feedback_data)
    @context = feedback_data[:context]
    @message = feedback_data[:message]
    @email = feedback_data[:email]
    @project_url = feedback_data[:project_url]
    @current_source = feedback_data[:current_source]
    @source_format = feedback_data[:source_format]
    @title = feedback_data[:title]
    @submitted_at = feedback_data[:submitted_at]
    @user = feedback_data[:user]

    mail(
      to: "feedback@pretext.plus",
      subject: "PreTeXt.Plus Feedback: #{@context}",
      from: "feedbackform@mailer.pretext.plus",
      reply_to: @email
    )
  end
end
