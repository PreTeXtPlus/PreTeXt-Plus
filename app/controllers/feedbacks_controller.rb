class FeedbacksController < ApplicationController
  allow_unauthenticated_access
  rate_limit to: 10, within: 10.minutes, only: :create, with: -> { render json: { error: "Too many feedback submissions. Please try again later." }, status: :too_many_requests }

  def create
    message = params[:message].to_s.strip
    return render json: { error: "Message is required." }, status: :unprocessable_entity if message.blank?

    user_email = params[:email].to_s.strip.presence
    source_content = params[:source_content].to_s.strip.presence
    latex_source = params[:latex_source].to_s.strip.presence
    project_id = params[:project_id].to_s.strip.presence

    FeedbackMailer.submit_feedback(
      message: message,
      user_email: user_email,
      source_content: source_content,
      latex_source: latex_source,
      project_id: project_id,
      user_agent: request.user_agent
    ).deliver_later

    render json: { success: true }
  end
end
