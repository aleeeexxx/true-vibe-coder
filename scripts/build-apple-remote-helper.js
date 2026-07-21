#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const helperSource = join(projectRoot, "helpers", "apple-remote-helper.swift");
const mediaRemoteHelperSource = join(
  projectRoot,
  "helpers",
  "media-remote-helper.swift"
);
const outputDirectory = join(projectRoot, "dist-native");
const outputPath = join(outputDirectory, "apple-remote-helper");
const mediaRemoteOutputPath = join(outputDirectory, "media-remote-helper");

if (process.platform !== "darwin") {
  console.log("Skipping Apple Remote helper build on non-macOS platform");
  process.exit(0);
}

mkdirSync(outputDirectory, { recursive: true });

execFileSync(
  "swiftc",
  [
    helperSource,
    "-O",
    "-framework",
    "IOKit",
    "-framework",
    "CoreFoundation",
    "-framework",
    "ApplicationServices",
    "-framework",
    "AppKit",
    "-F",
    "/System/Library/PrivateFrameworks",
    "-framework",
    "MultitouchSupport",
    "-o",
    outputPath,
  ],
  { stdio: "inherit" }
);

console.log(`Built Apple Remote helper: ${outputPath}`);

execFileSync(
  "swiftc",
  [
    mediaRemoteHelperSource,
    "-O",
    "-framework",
    "AVFoundation",
    "-framework",
    "MediaPlayer",
    "-o",
    mediaRemoteOutputPath,
  ],
  { stdio: "inherit" }
);

console.log(`Built media remote helper: ${mediaRemoteOutputPath}`);
