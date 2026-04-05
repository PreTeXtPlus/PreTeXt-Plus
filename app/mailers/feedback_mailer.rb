class FeedbackMailer < ApplicationMailer
  FEEDBACK_ADDRESS = "feedback@pretext.plus"

  def submit_feedback(message:, user_email: nil, source_content: nil, latex_source: nil, project_id: nil, user_agent: nil)
    @message = message
    @user_email = user_email.presence
    @source_content = source_content.presence
    @latex_source = latex_source.presence
    @project_id = project_id.presence
    @user_agent = user_agent.presence

    reply_to = @user_email if valid_email?(@user_email)

    mail(
      to: FEEDBACK_ADDRESS,
      reply_to: reply_to,
      subject: "PreTeXt.Plus Feedback#{@user_email.present? ? " from #{@user_email}" : ""}"
    )
  end

  private

  def valid_email?(email)
    email.present? && email.match?(/\A[^@\s]+@[^@\s]+\.[^@\s]+\z/)
  end
end
