require "etc"
require "open3"
require "socket"

module Admin
  class HostHealth
    def self.snapshot
      current_load_average, load_warning = self.load_average
      current_memory, memory_warning = self.memory
      current_disk, disk_warning = self.disk

      warnings = [ load_warning, memory_warning, disk_warning ].compact

      {
        available: current_load_average.present? || current_memory.present? || current_disk.present?,
        local_only: true,
        generated_at: Time.current,
        hostname: Socket.gethostname,
        cpu_cores: Etc.nprocessors,
        load_average: current_load_average,
        memory: current_memory,
        disk: current_disk,
        warnings: warnings
      }
    rescue SocketError => e
      unavailable_snapshot(e.message)
    rescue SystemCallError, IOError => e
      unavailable_snapshot(e.message)
    end

    def self.load_average
      return [ nil, "Load averages are unavailable on this platform." ] unless File.exist?("/proc/loadavg")

      values = File.read("/proc/loadavg").split.first(3).map(&:to_f)
      [ values, nil ]
    rescue SystemCallError, IOError => e
      [ nil, "Failed to read load averages: #{e.message}" ]
    end

    def self.memory
      return [ nil, "Memory usage is unavailable on this platform." ] unless File.exist?("/proc/meminfo")

      meminfo = File.read("/proc/meminfo").each_line.filter_map do |line|
        key, value = line.split(":", 2)
        next unless %w[MemTotal MemAvailable].include?(key)

        [ key, value.to_s.split.first.to_i * 1024 ]
      end.to_h

      return [ nil, "Memory usage is unavailable on this platform." ] if meminfo["MemTotal"].to_i <= 0

      total = meminfo["MemTotal"]
      available = meminfo["MemAvailable"].to_i
      used = total - available

      [
        {
          total_bytes: total,
          used_bytes: used,
          available_bytes: available,
          used_percent: ((used.to_f / total) * 100).round(1)
        },
        nil
      ]
    rescue SystemCallError, IOError => e
      [ nil, "Failed to read memory usage: #{e.message}" ]
    end

    def self.disk
      timeout_command = self.timeout_command
      return [ nil, "Disk usage timeout utility is unavailable on this host." ] if timeout_command.nil?

      output, status = Open3.capture2e(timeout_command, "3", "df", "-kP", "/")
      return [ nil, "Disk usage timed out on this host." ] if status.exitstatus == 124
      return [ nil, "Disk usage is unavailable on this platform." ] unless status.success?

      _, data = output.lines.map(&:strip).reject(&:empty?)
      return [ nil, "Disk usage is unavailable on this platform." ] if data.blank?

      filesystem, total_kb, used_kb, available_kb, percent_used, mount = data.split(/\s+/, 6)

      [
        {
          filesystem: filesystem,
          total_bytes: total_kb.to_i * 1024,
          used_bytes: used_kb.to_i * 1024,
          available_bytes: available_kb.to_i * 1024,
          used_percent: percent_used.delete("%").to_i,
          mount: mount
        },
        nil
      ]
    rescue SystemCallError, IOError => e
      [ nil, "Failed to read disk usage: #{e.message}" ]
    end

    def self.unavailable_snapshot(message)
      {
        available: false,
        local_only: true,
        generated_at: Time.current,
        hostname: nil,
        cpu_cores: nil,
        load_average: nil,
        memory: nil,
        disk: nil,
        warnings: [ "Host metrics unavailable: #{message}" ]
      }
    end

    def self.timeout_command
      ENV.fetch("PATH", "")
        .split(File::PATH_SEPARATOR)
        .product(%w[timeout gtimeout])
        .find { |dir, command| File.executable?(File.join(dir, command)) && !File.directory?(File.join(dir, command)) }
        &.last
    end

    private_class_method :unavailable_snapshot
  end
end
