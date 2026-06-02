class LibraryAssetsController < ApplicationController
  before_action :set_library_asset_and_authorize, only: %i[ show edit update destroy ]

  def index
    @library_assets = LibraryAsset.where user: @current_user
  end

  def show
  end

  def new
    @library_asset = LibraryAsset.new
  end

  def edit
  end

  def create
    @library_asset = LibraryAsset.new(library_asset_params)
    @library_asset.user = @current_user

    respond_to do |format|
      if @library_asset.save
        format.html { redirect_to @library_asset, notice: "Library asset was successfully created." }
        format.json { render :show, status: :created, location: @library_asset }
      else
        format.html { render :new, status: :unprocessable_entity }
        format.json { render json: @library_asset.errors, status: :unprocessable_entity }
      end
    end
  end

  def update
    respond_to do |format|
      if @library_asset.update(library_asset_params)
        format.html { redirect_to @library_asset, notice: "Library asset was successfully updated.", status: :see_other }
        format.json { render :show, status: :ok, location: @library_asset }
      else
        format.html { render :edit, status: :unprocessable_entity }
        format.json { render json: @library_asset.errors, status: :unprocessable_entity }
      end
    end
  end

  def destroy
    @library_asset.destroy!

    respond_to do |format|
      format.html { redirect_to library_assets_path, notice: "Library asset was successfully destroyed.", status: :see_other }
      format.json { head :no_content }
    end
  end

  private
    # Use callbacks to share common setup or constraints between actions.
    def set_library_asset_and_authorize
      @library_asset = LibraryAsset.find(params.expect(:id))
      if @library_asset.user != @current_user
        redirect_to library_assets_path, alert: "Not authorized"
      end
    end

    # Only allow a list of trusted parameters through.
    def library_asset_params
      params.expect(library_asset: [ :file, :filename ])
    end
end
