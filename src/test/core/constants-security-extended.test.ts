/**
 * Extended coverage: exported security-related constants (Security / Boundary).
 * Maps to feature F-SECURITY-CONSTANTS.
 */
import { describe, it, expect } from 'vitest';
import {
  DEPLOY_NAME_PATTERN,
  BLOCKED_ENV_KEYS,
  BLOCKED_VMARGS_PREFIXES,
  WEBVIEW_PROTOCOL_VERSION,
  ATOMIC_WRITE_MAX_RETRIES,
  ATOMIC_WRITE_BACKOFFS_MS,
} from '../../constants';

describe('Security & contract constants (extended)', () => {
  it('EXT-CONST-001: DEPLOY_NAME_PATTERN accepts alphanumeric start and common chars', () => {
    expect(DEPLOY_NAME_PATTERN.test('app')).toBe(true);
    expect(DEPLOY_NAME_PATTERN.test('app_v2')).toBe(true);
    expect(DEPLOY_NAME_PATTERN.test('a.b-c_d')).toBe(true);
  });

  it('EXT-CONST-002: DEPLOY_NAME_PATTERN rejects empty and bad first char', () => {
    expect(DEPLOY_NAME_PATTERN.test('')).toBe(false);
    expect(DEPLOY_NAME_PATTERN.test('-bad')).toBe(false);
    expect(DEPLOY_NAME_PATTERN.test('_bad')).toBe(false);
    expect(DEPLOY_NAME_PATTERN.test('.bad')).toBe(false);
  });

  it('EXT-CONST-003: DEPLOY_NAME_PATTERN rejects path-like names', () => {
    expect(DEPLOY_NAME_PATTERN.test('a/b')).toBe(false);
    expect(DEPLOY_NAME_PATTERN.test('a\\b')).toBe(false);
  });

  it('EXT-CONST-004: BLOCKED_ENV_KEYS contains JVM injection vectors', () => {
    expect(BLOCKED_ENV_KEYS.has('JAVA_TOOL_OPTIONS')).toBe(true);
    expect(BLOCKED_ENV_KEYS.has('LD_PRELOAD')).toBe(true);
    expect(BLOCKED_ENV_KEYS.has('_JAVA_OPTIONS')).toBe(true);
  });

  it('EXT-CONST-005: BLOCKED_VMARGS_PREFIXES covers agents and OOM hooks', () => {
    const joined = BLOCKED_VMARGS_PREFIXES.join('|');
    expect(joined).toContain('javaagent');
    expect(joined).toContain('OnOutOfMemoryError');
  });

  it('EXT-CONST-006: WEBVIEW_PROTOCOL_VERSION is stable positive integer', () => {
    expect(WEBVIEW_PROTOCOL_VERSION).toBe(1);
  });

  it('EXT-CONST-007: atomic write backoff length matches retry budget', () => {
    expect(ATOMIC_WRITE_BACKOFFS_MS.length).toBe(ATOMIC_WRITE_MAX_RETRIES);
  });

  it('EXT-CONST-008: backoff values are strictly increasing', () => {
    for (let i = 1; i < ATOMIC_WRITE_BACKOFFS_MS.length; i++) {
      expect(ATOMIC_WRITE_BACKOFFS_MS[i]).toBeGreaterThan(ATOMIC_WRITE_BACKOFFS_MS[i - 1]);
    }
  });
});
