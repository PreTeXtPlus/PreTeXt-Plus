class LibraryAssetsController < ApplicationController
  before_action :set_library_asset, only: %i[ show edit update destroy ]
  before_action :authorize_library_asset, only: %i[ show edit update destroy ]

  def index
    @library_assets = LibraryAsset.where user: current_user
  end

  def show
  end

  def create
    @library_asset = LibraryAsset.new(library_asset_params)
    @library_asset.user = current_user

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
    def set_library_asset
      @library_asset = LibraryAsset.find(params.expect(:id))
    end

    def authorize_library_asset
      authorize! :manage, @library_asset
    end

    # Only allow a list of trusted parameters through.
    def library_asset_params
      params.expect(library_asset: [ :kind, :file, :content, :description, :short_description ])
    end
end
