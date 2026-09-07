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
    // DMG upgrades remain manual until an Apple Developer signing identity and
    // notarization credentials are configured. No unsigned auto-update ZIP.
    identity: null,
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
