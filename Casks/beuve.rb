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
    beuve is ad-hoc signed and not notarized, so macOS will block its first launch.
    To allow it, either:
      - open beuve once, then go to System Settings > Privacy & Security and click
        "Open Anyway" (Control-click > Open no longer works on macOS 15 and later), or
      - run: xattr -dr com.apple.quarantine #{appdir}/beuve.app
  EOS
end
