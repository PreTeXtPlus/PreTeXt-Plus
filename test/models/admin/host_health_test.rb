require "test_helper"

class Admin::HostHealthTest < ActiveSupport::TestCase
  test "snapshot combines metric readers" do
    generated_at = Time.current

    Admin::HostHealth.stub(:load_average, [ [ 0.1, 0.2, 0.3 ], nil ]) do
      Admin::HostHealth.stub(:memory, [ { total_bytes: 1024, used_bytes: 512, available_bytes: 512, used_percent: 50.0 }, nil ]) do
        Admin::HostHealth.stub(:disk, [ { filesystem: "/dev/root", total_bytes: 2048, used_bytes: 1024, available_bytes: 1024, used_percent: 50, mount: "/" }, nil ]) do
          Time.stub(:current, generated_at) do
            snapshot = Admin::HostHealth.snapshot

            assert_equal true, snapshot[:available]
            assert_equal true, snapshot[:local_only]
            assert_equal [ 0.1, 0.2, 0.3 ], snapshot[:load_average]
            assert_equal 50.0, snapshot[:memory][:used_percent]
            assert_equal "/dev/root", snapshot[:disk][:filesystem]
            assert_equal generated_at, snapshot[:generated_at]
          end
        end
      end
    end
  end

  test "disk returns a warning when the command times out" do
    Timeout.stub(:timeout, proc { |_duration, &_block| raise Timeout::Error }) do
      disk, warning = Admin::HostHealth.disk

      assert_nil disk
      assert_equal "Disk usage timed out on this host.", warning
    end
  end
end
