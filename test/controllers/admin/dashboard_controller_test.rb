require "test_helper"

class Admin::DashboardControllerTest < ActionDispatch::IntegrationTest
  setup do
    @admin = users(:one)
    @admin.update!(admin: true)
    @non_admin = users(:two)
  end

  test "redirects non-admin users" do
    sign_in_as(@non_admin)

    get admin_root_path

    assert_redirected_to projects_path
  end

  test "renders dashboard for admins" do
    sign_in_as(@admin)
    @admin.sessions.create!(ip_address: "127.0.0.1", user_agent: "Admin Browser")

    host_health = {
      available: true,
      local_only: true,
      generated_at: Time.current,
      hostname: "app-host-1",
      cpu_cores: 4,
      load_average: [ 0.12, 0.24, 0.36 ],
      memory: { total_bytes: 8.gigabytes, used_bytes: 4.gigabytes, available_bytes: 4.gigabytes, used_percent: 50.0 },
      disk: { filesystem: "/dev/root", total_bytes: 100.gigabytes, used_bytes: 55.gigabytes, available_bytes: 45.gigabytes, used_percent: 55, mount: "/" },
      warnings: [ "Local runtime metrics only." ]
    }

    Admin::HostHealth.stub(:snapshot, host_health) do
      get admin_root_path
    end

    assert_response :success
    assert_includes response.body, "Admin dashboard"
    assert_includes response.body, "Host health"
    assert_includes response.body, "Local runtime metrics only"
    assert_includes response.body, "Recent sign-ins"
  end
end
