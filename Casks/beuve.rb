cask "beuve" do
  version "0.1.0"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"

  url "https://github.com/bdchauvette/beuve/releases/download/v#{version}/beuve-#{version}-mac-arm64.zip"
  name "beuve"
  desc "Code review and verification workbench"
  homepage "https://github.com/bdchauvette/beuve"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: :ventura

  app "beuve.app"

  # beuve is ad-hoc signed, not notarized (ADR 0048), so Gatekeeper rejects a quarantined copy.
  # Homebrew no longer has --no-quarantine; this removes the attribute from this one app only.
  postflight_steps do
    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{appdir}}/beuve.app"]
  end

  zap trash: [
    "~/Library/Application Support/beuve",
    "~/Library/Caches/beuve",
    "~/Library/Caches/dev.amoskeag.beuve",
    "~/Library/HTTPStorages/dev.amoskeag.beuve",
    "~/Library/Logs/beuve",
    "~/Library/Preferences/dev.amoskeag.beuve.plist",
    "~/Library/Saved Application State/dev.amoskeag.beuve.savedState",
  ]

  caveats <<~EOS
    beuve is ad-hoc signed and not notarized, so macOS Gatekeeper would block it.
    This cask removes the com.apple.quarantine attribute from #{appdir}/beuve.app, and only
    from that app, right after installing. That is you trusting this build; its checksum is
    the sha256 above, from the release's SHA256SUMS.
  EOS
end
