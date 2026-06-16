Rails.application.routes.draw do
  namespace :admin do
    root "dashboard#show"
    resources :users, only: %i[index show]
    resources :projects, only: %i[show]
    resources :terms, only: %i[new create]
  end

  devise_for :users, skip: [ :registrations ], controllers: {
    sessions: "users/sessions",
    passwords: "users/passwords"
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
  resources :requests, only: [ :create ]
  resources :invitations, only: [ :new, :create ]
  post "invitations/redeem" => "invitations#redeem", as: :redeem_invitation
  resources :projects do
    collection do
      post "preview" => "projects#preview", as: "preview"
      post "feedback" => "projects#feedback", as: "feedback"
      get "lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
      get "*_/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
      get ":id/*_.html", to: redirect("/projects/%{id}/share")
      get "*_/icon.svg", to: redirect("/icon-small.svg")
    end
    member do
      get "share" => "projects#share", as: "share"
      get "share/external/:ref" => "projects#show_asset_file", as: "show_asset_file"
      get "share/source" => "projects#source", as: "share_source"
      get "share/copy", to: redirect("projects/%{project_id}/share/source")
      post "share/copy" => "projects#copy", as: "copy"
      get "*/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
    end
  end
  scope format: true, constraints: { format: "json" } do
    resources :library_assets, path: "library", only: [ :index, :show, :create, :update, :destroy ]
  end
  post "subscribe" => "subscriptions_old#subscribe"
  post "stripe/webhooks" => "subscriptions_old#webhooks"
  get "tryit" => "projects#tryit"

  get "up" => "rails/health#show", as: :rails_health_check

  root "pages#home"
end
