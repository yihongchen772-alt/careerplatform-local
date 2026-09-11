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
    // whisper.cpp CLI for 面试录音's local transcription (built by
    // scripts/fetch-whisper.cjs, run from desktop:prepare). Lands at
    // <app>/Contents/Resources/whisper/, where electron/whisper.js looks.
    extraResources: [{ from: "build/whisper/darwin-arm64", to: "whisper" }],
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
    extendInfo: {
      NSMicrophoneUsageDescription: "模拟面试的口头作答和面试录音需要使用麦克风。面试录音默认在本机转写；未下载本地模型时才会发给你自己配置的 AI 服务商，不会上传到别处。",
    },
  },
  win: {
    icon: "build/icon.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
    // Same as mac.extraResources: the official whisper-bin-x64 build (CLI +
    // per-CPU ggml DLLs) at <install>/resources/whisper/.
    extraResources: [{ from: "build/whisper/win32-x64", to: "whisper" }],
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
