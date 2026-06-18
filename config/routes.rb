Rails.application.routes.draw do
  namespace :admin do
    root "dashboard#show"
    resources :users, only: %i[index show] do
      member do
        post :confirm
      end
    end
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
  get "projects/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
  get "projects/*_/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
  get "projects/:id/*_.html", to: redirect("/projects/%{id}/share")
  get "projects/*_/icon.svg", to: redirect("/icon-small.svg")
  resources :projects do
    scope format: true, constraints: { format: "json" } do
      resources :project_assets, path: "library", as: "assets", only: [ :index, :show, :create, :update, :destroy ]
    end
    member do
      get  :editor_state
      patch :editor_state, action: :update_editor_state
      get "share" => "projects#share", as: "share"
      get "share/external/:ref" => "projects#show_asset_file", as: "show_asset_file"
      get "share/source" => "projects#source", as: "share_source"
      get "share/copy", to: redirect("projects/%{project_id}/share/source")
      post "share/copy" => "projects#copy", as: "copy"
      post "copy_conversion" => "projects#copy_conversion", as: "copy_conversion"
      get "*/lunr-pretext-search-index.js", to: redirect("/ptx-search.js")
    end
  end
  post "projects/preview" => "projects#preview", as: "preview"
  post "projects/feedback" => "projects#feedback", as: "feedback"
  scope format: true, constraints: { format: "json" } do
    resources :library_assets, path: "library", only: [ :index, :show, :create, :update, :destroy ]
  end
  post "subscribe" => "subscriptions_old#subscribe"
  post "stripe/webhooks" => "subscriptions_old#webhooks"
  get "tryit" => "projects#tryit"

  get "up" => "rails/health#show", as: :rails_health_check

  root "pages#home"
end
