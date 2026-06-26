class AssetFetchesController < ApplicationController
  # Fetches the bytes of a user-supplied image URL server-side (so the
  # browser doesn't hit CORS) without persisting anything. The editor commits
  # the returned bytes through the existing upload path (#onAssetUpload),
  # which remains the sole creator of LibraryAsset/ActiveStorage records.
  def create
    url = params[:url].presence
    return render_error("URL is required") unless url

    body, content_type = SafeUrlFetcher.call(url)
    send_data body, type: content_type, disposition: "inline"
  rescue SafeUrlFetcher::UnsafeUrlError, SafeUrlFetcher::FetchError => e
    render_error(e.message)
  end

  private
    def render_error(message)
      render json: { error: message }, status: :unprocessable_entity
    end
end
