#!/usr/bin/env node

import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("Skipping True Vibe Coder asset generation outside macOS.");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
const publicDir = path.join(root, "public");
const appIconSvg = path.join(buildDir, "true-vibe-coder-icon.svg");
const trayIconSvg = path.join(buildDir, "true-vibe-coder-tray.svg");
const appIconPng = path.join(buildDir, "icon.png");
const tray1x = path.join(publicDir, "trueVibeCoderTemplate.png");
const tray2x = path.join(publicDir, "trueVibeCoderTemplate@2x.png");
const temporaryDir = mkdtempSync(path.join(os.tmpdir(), "true-vibe-coder-assets-"));

function sips(...args) {
  execFileSync("sips", args, { stdio: "ignore" });
}

try {
  mkdirSync(publicDir, { recursive: true });

  const sourceIconPng = path.join(temporaryDir, "source-icon.png");
  sips("-s", "format", "png", appIconSvg, "--out", sourceIconPng);
  sips("-z", "2048", "2048", sourceIconPng, "--out", appIconPng);
  cpSync(appIconPng, path.join(publicDir, "icon.png"));

  const icoSource = path.join(temporaryDir, "icon-256.png");
  sips("-z", "256", "256", appIconPng, "--out", icoSource);
  sips("-s", "format", "ico", icoSource, "--out", path.join(buildDir, "icon.ico"));
  cpSync(path.join(buildDir, "icon.ico"), path.join(publicDir, "favicon.ico"));

  const iconset = path.join(temporaryDir, "TrueVibeCoder.iconset");
  mkdirSync(iconset);
  for (const [name, size] of [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ]) {
    sips("-z", String(size), String(size), appIconPng, "--out", path.join(iconset, name));
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(buildDir, "icon.icns")]);

  sips("-s", "format", "png", trayIconSvg, "--out", tray2x);
  sips("-z", "16", "16", tray2x, "--out", tray1x);

  console.log("Built True Vibe Coder app and menu bar assets.");
} finally {
  rmSync(temporaryDir, { recursive: true, force: true });
}
