#!/usr/bin/env node

/**
 * Prepares electron-builder configuration based on available signing certificates
 * If no certificates are available, disables hardenedRuntime for ad-hoc signing
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = join(__dirname, '..', 'electron-builder.json');

const config = JSON.parse(readFileSync(configPath, 'utf8'));

// Check if we have macOS signing certificates
// Method 1: Check environment variables (set in GitHub Actions)
const hasMacCertEnv = process.env.MACOS_CERTIFICATE_BASE64 && 
                      process.env.MACOS_CERTIFICATE_BASE64 !== '' &&
                      process.env.MACOS_CERTIFICATE_BASE64 !== 'undefined';

// Method 2: Check if CSC_IDENTITY is set (set by electron-builder or certificate import)
const hasCscIdentity = process.env.CSC_IDENTITY && process.env.CSC_IDENTITY !== '';

// Method 3: Try to find a valid signing identity in keychain (macOS only)
let hasKeychainCert = false;
let keychainIdentity = null;
let isDeveloperIdCert = false;
if (process.platform === 'darwin') {
  try {
    const identities = execSync('security find-identity -v -p codesigning', { encoding: 'utf8', stdio: 'pipe' });
    // Check if we have any valid Developer ID or Apple Development certificates
    hasKeychainCert = identities.includes('Developer ID Application') || 
                     identities.includes('Apple Development');
    
    // Extract the identity name if found
    if (hasKeychainCert) {
      // Look for Developer ID Application first (for distribution)
      const devIdMatch = identities.match(/"Developer ID Application: ([^"]+)"/);
      if (devIdMatch) {
        keychainIdentity = devIdMatch[1];
        isDeveloperIdCert = true;
      } else {
        // Fall back to Apple Development
        const appleDevMatch = identities.match(/"Apple Development: ([^"]+)"/);
        if (appleDevMatch) {
          keychainIdentity = appleDevMatch[1];
          isDeveloperIdCert = false; // Apple Development certs cannot be notarized
        }
      }
    }
  } catch (e) {
    // If command fails, assume no certificates
    hasKeychainCert = false;
  }
}

// Check if CSC_IDENTITY points to a Developer ID certificate
if (hasCscIdentity && process.env.CSC_IDENTITY) {
  const cscIdentity = process.env.CSC_IDENTITY;
  // Check if it's a Developer ID certificate (not Apple Development)
  if (cscIdentity.includes('Developer ID')) {
    isDeveloperIdCert = true;
  } else if (cscIdentity.includes('Apple Development')) {
    isDeveloperIdCert = false;
  }
}

const hasMacCert = hasMacCertEnv || hasCscIdentity || hasKeychainCert;
const hasAppleId = process.env.APPLE_TEAM_ID && 
                   process.env.APPLE_TEAM_ID !== '' && 
                   process.env.APPLE_TEAM_ID !== 'undefined';

// If no signing certificates, disable hardenedRuntime for ad-hoc signing
if (!hasMacCert) {
  console.log('⚠️  No macOS certificate found - using ad-hoc signing (hardenedRuntime disabled)');
  console.log('   The app will open but may show a Gatekeeper warning');
  config.mac.hardenedRuntime = false;
  // Remove entitlements requirement for ad-hoc signing
  delete config.mac.entitlements;
  delete config.mac.entitlementsInherit;
  // electron-builder 26.x requires notarize to be a boolean
  config.mac.notarize = false;
  // Keep identity as null for ad-hoc signing
  config.mac.identity = null;
} else {
  console.log('✅ macOS certificate found - using proper code signing');
  config.mac.hardenedRuntime = true;
  config.mac.entitlements = 'build/entitlements.mac.plist';
  config.mac.entitlementsInherit = 'build/entitlements.mac.plist';
  
  // Set identity for code signing
  // Priority: CSC_IDENTITY env var > keychain identity > remove to auto-detect
  if (hasCscIdentity) {
    config.mac.identity = process.env.CSC_IDENTITY;
    console.log(`✅ Using signing identity from CSC_IDENTITY: ${process.env.CSC_IDENTITY}`);
  } else if (keychainIdentity) {
    config.mac.identity = keychainIdentity;
    console.log(`✅ Using signing identity from keychain: ${keychainIdentity}`);
  } else {
    // Remove identity field to let electron-builder auto-detect the certificate
    delete config.mac.identity;
    console.log('✅ Identity field removed - electron-builder will auto-detect certificate');
  }
  
  // Only enable notarization if:
  // 1. We have Apple ID credentials (APPLE_TEAM_ID)
  // 2. We're using a Developer ID certificate (not Apple Development)
  // Apple Development certificates cannot be notarized - only Developer ID certificates can
  // electron-builder 26.x requires notarize to be a boolean
  if (hasAppleId && isDeveloperIdCert) {
    console.log('✅ Apple Team ID found + Developer ID certificate - notarization will be enabled (set APPLE_* env vars)');
    config.mac.notarize = true;
  } else {
    if (hasAppleId && !isDeveloperIdCert) {
      console.log('⚠️  Apple Team ID found but certificate is Apple Development (not Developer ID)');
      console.log('   Notarization requires a Developer ID certificate - skipping notarization');
    } else if (!hasAppleId && isDeveloperIdCert) {
      console.log('⚠️  Developer ID certificate found but no Apple Team ID - skipping notarization');
    } else {
      console.log('⚠️  No Apple Team ID - skipping notarization');
    }
    config.mac.notarize = false;
  }
}

writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('📝 electron-builder.json updated for signing configuration');

