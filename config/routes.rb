Rails.application.routes.draw do
  namespace :admin do
    root "dashboard#show"
    resources :users, only: %i[index show] do
      member do
        post :confirm
        post :reset_password
      end
    end
    resources :projects, only: %i[show]
    resources :terms, only: %i[new create]
    resources :announcements do
      member do
        post :publish
      end
    end
  end

  devise_for :users, skip: [ :registrations ], controllers: {
    sessions: "users/sessions",
    passwords: "users/passwords",
    confirmations: "users/confirmations"
  }
  resources :users, only: [ :new, :create, :edit, :update ]

  get "tos" => "terms#tos", as: "tos"
  get "privacy" => "terms#privacy", as: "privacy"
  get "subscriptions/invoice" => "subscriptions#invoice_request", as: "invoice_request"
  post "subscriptions/invoice" => "subscriptions#submit_invoice_request", as: "submit_invoice_request"
  resources :subscriptions, only: [ :index, :show ] do
    member do
      post "seat" => "subscriptions#seat", as: "seat"
    end
  end
  resources :subscription_types do
    member do
      get "checkout" => "subscription_types#checkout", as: "checkout"
    end
  end
  resources :projects do
    resources :builds, only: [ :index, :show, :create, :destroy ] do
      # Async status webhook from the full build server; authenticated by HMAC
      # signature, not login (see BuildCallbacksController).
      member do
        post "full_callback" => "build_callbacks#create", as: "full_callback"
        post "check_status" => "builds#check_status", as: "check_status"
      end
    end
    collection do
      post "feedback" => "projects#feedback", as: "feedback"
      get "lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
      get "*_/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
      get ":id/*_.html", to: redirect("/projects/%{id}/share")
    end
    member do
      get "share" => "projects#share", as: "share"
      get "share/source" => "projects#source", as: "share_source"
      get "share/copy" => "projects#copy_redirect"
      post "share/copy" => "projects#copy", as: "copy"
      get "(*_)/external/:ref" => "assets#share", as: "share_asset"
      post "preview" => "projects#preview", as: "preview"
      get "*/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
    end
  end
  resources :announcements, only: %i[index show]

  # Deprecated asset share link (used by old builds to serve up assets).
  get "share_assets/external/:id" => "assets#file", as: "share_asset_file"
  get "builds/:build_id/files(/*relative_path)", to: "build_files#show", as: "build_file", format: false
  resources :asset_fetches, only: :create
  get "tryit" => "projects#tryit"
  post "tryit/preview" => "projects#preview", as: "tryit_preview"
  get "tryit/external/icon" => redirect("/icon-small.png")  # only allowed "asset" in tryit

  get "up" => "rails/health#show", as: :rails_health_check

  root "pages#home"
end
