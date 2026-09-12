const { afterPack } = require("./scripts/packaging-prepare.cjs");

module.exports = {
  appId: "com.careerplatform.local",
  productName: "求职罗盘",
  asar: true,
  // The Node-mode child process needs physical files outside Electron's ASAR.
  asarUnpack: ["electron/backup-worker.cjs", "electron/data-backup.cjs"],
  npmRebuild: false,
  compression: "normal",
  directories: {
    app: ".local-run/packaging/shell",
    output: "dist-electron",
    buildResources: "build",
  },
  files: ["electron/**/*", "package.json", "node_modules/**/*"],
  afterPack,
  artifactName: "JobCompass-${version}-${os}-${arch}.${ext}",
  publish: [{ provider: "github", owner: "yihongchen772-alt", repo: "careerplatform-local", releaseType: "draft" }],
  mac: {
    target: [{ target: "dmg", arch: ["arm64"] }],
    icon: "build/icon.icns",
    category: "public.app-category.productivity",
    // "-" = ad-hoc signing, not "no signing". A completely unsigned Mach-O
    // binary (identity: null) fails to launch at all on Apple Silicon — the
    // OS's code-signature check (AMFI) is mandatory there, not just Gatekeeper
    // quarantine — so identity: null shipped an app that showed "已损坏，无法
    // 打开" on every arm64 Mac. Ad-hoc signing needs no Apple Developer
    // account or certificate; it only stops short of removing the "无法验证
    // 开发者" Gatekeeper prompt on first launch (right-click → 打开 clears
    // it), which real Developer ID signing + notarization would still fix.
    // DMG upgrades remain manual until that's configured. No unsigned
    // auto-update ZIP.
    identity: "-",
    // electron-builder's own default entitlements (allow-jit,
    // allow-unsigned-executable-memory, disable-library-validation) don't
    // include audio-input — under Hardened Runtime that silently blocks mic
    // capture below the TCC layer, so the app never even shows up in
    // System Settings > Privacy & Security > Microphone. See
    // build/entitlements.mac.plist.
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    extendInfo: {
      NSMicrophoneUsageDescription: "模拟面试的口头作答需要使用麦克风录音。录音只发送到你自己配置的 AI 服务商做转写，不会上传到别处。",
    },
  },
  win: {
    icon: "build/icon.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    differentialPackage: true,
    runAfterFinish: true,
    createDesktopShortcut: "always",
    shortcutName: "求职罗盘",
  },
};
