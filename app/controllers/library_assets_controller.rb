class LibraryAssetsController < ApplicationController
  load_and_authorize_resource

  def index
    @library_assets = LibraryAsset.where user: current_user
  end

  def show
  end

  def create
    @library_asset.user = current_user

    # "Add image by URL": there's no url column, so we download the remote image
    # and attach it as the asset's file (so #url keeps working even if the source
    # later disappears).  The url is read raw -- it's deliberately not a
    # permitted, mass-assignable attribute.
    remote_url = params.dig(:library_asset, :url).presence
    if remote_url && !attach_remote_file(@library_asset, remote_url)
      return render json: { error: "Could not fetch image from URL." }, status: :unprocessable_entity
    end

    respond_to do |format|
      if @library_asset.save
        format.json { render :show, status: :created, location: @library_asset }
      else
        format.json { render json: @library_asset.errors, status: :unprocessable_entity }
      end
    end
  end

  def update
    respond_to do |format|
      if @library_asset.update(library_asset_params)
        format.json { render :show, status: :ok, location: @library_asset }
      else
        format.json { render json: @library_asset.errors, status: :unprocessable_entity }
      end
    end
  end

  def destroy
    @library_asset.destroy!

    respond_to do |format|
      format.json { head :no_content }
    end
  end

  private
    # Only allow a list of trusted parameters through.
    def library_asset_params
      params.expect(library_asset: [ :kind, :file, :content, :description, :short_description ])
    end

    # Fetch a remote image and attach it to the asset's file.  Returns true on
    # success, false on any HTTP/network failure (so create can report it).
    def attach_remote_file(library_asset, url)
      require "uri"
      require "net/http"
      uri = URI.parse(url)
      return false unless uri.is_a?(URI::HTTP) || uri.is_a?(URI::HTTPS)

      response = Net::HTTP.get_response(uri)
      return false unless response.is_a?(Net::HTTPSuccess) && response.body.present?

      filename = File.basename(uri.path).presence || "image"
      library_asset.file.attach(
        io: StringIO.new(response.body),
        filename: filename,
        content_type: response.content_type
      )
      true
    rescue URI::InvalidURIError, SocketError, SystemCallError, Net::OpenTimeout, Net::ReadTimeout, IOError
      false
    end
end
