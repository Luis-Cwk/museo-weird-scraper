/**
 * lib/validations.js — Validation utilities for Huaca agent pipeline
 *
 * Functions:
 *   - validateStructure(filePath, targetName): check HTML file is valid + safe to deploy
 *   - verifyUpload(url): check that a deployed URL is reachable
 *   - sha256(content): compute SHA-256 hash of a string
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Validate an HTML file structure before deployment.
 *
 * Rejects:
 *   - Missing files
 *   - Files smaller than 50 bytes (likely empty/broken)
 *   - Files without DOCTYPE or <html> tag
 *   - Files with path traversal attempts in targetName (../)
 *   - Files containing <script src="http(s)://..."> (external scripts not allowed)
 *
 * @param {string} filePath - absolute path to the HTML file
 * @param {string} targetName - what we're going to name it on the deploy
 * @returns {{ok: boolean, reason?: string, sha256?: string, size?: number}}
 */
function validateStructure(filePath, targetName) {
  // Path traversal check: targetName must not contain ../
  if (targetName.includes("..") || targetName.includes("/") || targetName.includes("\\")) {
    return { ok: false, reason: "path traversal detected in target name" };
  }

  // File must exist
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: `file not found: ${filePath}` };
  }

  // File must be > 50 bytes
  const content = fs.readFileSync(filePath, "utf-8");
  const size = content.length;
  if (size < 50) {
    return { ok: false, reason: `file too small (${size} bytes)`, size };
  }

  // Must contain DOCTYPE or <html>
  if (!content.includes("<!DOCTYPE") && !content.toLowerCase().includes("<html")) {
    return { ok: false, reason: "html missing DOCTYPE or <html> tag", size };
  }

  // Reject external scripts
  const extScriptRegex = /<script[^>]+src\s*=\s*["']https?:\/\//i;
  if (extScriptRegex.test(content)) {
    return { ok: false, reason: "external script src detected", size };
  }

  // Compute SHA-256 for traceability
  const hash = crypto.createHash("sha256").update(content).digest("hex");

  return { ok: true, sha256: hash, size };
}

/**
 * Verify a deployed URL is reachable.
 *
 * @param {string} url - URL to check
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
async function verifyUpload(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Compute SHA-256 hash of a string.
 *
 * @param {string} content
 * @returns {string} hex digest
 */
function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

module.exports = { validateStructure, verifyUpload, sha256 };
