/**
 * Exhaustive test suite: Protocol validation + bridge utilities
 *
 * Tests the webview protocol at its boundaries — version mismatches,
 * malformed messages, type coercion attacks, XSS payloads.
 * Also tests the client-side bridge message creation.
 */

import { describe, it, expect } from 'vitest';
import { WEBVIEW_PROTOCOL_VERSION } from '@ui/webviews/protocol';
import type { WebviewToHost, HostToWebview } from '@ui/webviews/protocol';

/* ══════════════════════════════════════════════════════════════════════════
 * isValidProtocolMessage — extracted logic for generic webview message guards
 * ══════════════════════════════════════════════════════════════════════════ */

// Re-implement the validation logic here to test it exhaustively,
// since the host-side guard is not exported directly.
function isValidProtocolMessage(raw: unknown): raw is WebviewToHost {
  if (typeof raw !== 'object' || raw === null) return false;
  const msg = raw as Record<string, unknown>;
  return msg['v'] === WEBVIEW_PROTOCOL_VERSION && typeof msg['command'] === 'string';
}

describe('Protocol Message Validation', () => {

  /* ── Valid Messages ──────────────────────────────────────────────────── */

  describe('Valid Messages', () => {
    it('should accept ready message', () => {
      expect(isValidProtocolMessage({ v: 1, command: 'ready' })).toBe(true);
    });

    it('should accept submit with data', () => {
      expect(isValidProtocolMessage({ v: 1, command: 'submit', data: { name: 'Test' } })).toBe(true);
    });

    it('should accept validate with data', () => {
      expect(isValidProtocolMessage({ v: 1, command: 'validate', data: {} })).toBe(true);
    });

    it('should accept validateField with field and value', () => {
      expect(isValidProtocolMessage({ v: 1, command: 'validateField', field: 'name', value: 'x' })).toBe(true);
    });

    it('should accept browse with field and kind', () => {
      expect(isValidProtocolMessage({ v: 1, command: 'browse', field: 'path', kind: 'directory' })).toBe(true);
    });

    it('should accept cancel', () => {
      expect(isValidProtocolMessage({ v: 1, command: 'cancel' })).toBe(true);
    });

  });

  /* ── Version Mismatch ────────────────────────────────────────────────── */

  describe('Version Mismatch', () => {
    it('should reject version 0', () => {
      expect(isValidProtocolMessage({ v: 0, command: 'ready' })).toBe(false);
    });

    it('should reject version 2', () => {
      expect(isValidProtocolMessage({ v: 2, command: 'ready' })).toBe(false);
    });

    it('should reject string version "1"', () => {
      expect(isValidProtocolMessage({ v: '1', command: 'ready' })).toBe(false);
    });

    it('should reject undefined version', () => {
      expect(isValidProtocolMessage({ command: 'ready' })).toBe(false);
    });

    it('should reject null version', () => {
      expect(isValidProtocolMessage({ v: null, command: 'ready' })).toBe(false);
    });

    it('should reject negative version', () => {
      expect(isValidProtocolMessage({ v: -1, command: 'ready' })).toBe(false);
    });

    it('should reject NaN version', () => {
      expect(isValidProtocolMessage({ v: NaN, command: 'ready' })).toBe(false);
    });

    it('should reject Infinity version', () => {
      expect(isValidProtocolMessage({ v: Infinity, command: 'ready' })).toBe(false);
    });

    it('should reject boolean version true', () => {
      expect(isValidProtocolMessage({ v: true, command: 'ready' })).toBe(false);
    });
  });

  /* ── Missing/Invalid Command ─────────────────────────────────────────── */

  describe('Missing/Invalid Command', () => {
    it('should reject missing command field', () => {
      expect(isValidProtocolMessage({ v: 1 })).toBe(false);
    });

    it('should reject numeric command', () => {
      expect(isValidProtocolMessage({ v: 1, command: 42 })).toBe(false);
    });

    it('should reject null command', () => {
      expect(isValidProtocolMessage({ v: 1, command: null })).toBe(false);
    });

    it('should reject boolean command', () => {
      expect(isValidProtocolMessage({ v: 1, command: true })).toBe(false);
    });

    it('should reject array command', () => {
      expect(isValidProtocolMessage({ v: 1, command: ['ready'] })).toBe(false);
    });

    it('should reject object command', () => {
      expect(isValidProtocolMessage({ v: 1, command: { type: 'ready' } })).toBe(false);
    });

    it('should accept empty string command (valid string, unknown command)', () => {
      // The validator only checks typeof === 'string', not known commands
      expect(isValidProtocolMessage({ v: 1, command: '' })).toBe(true);
    });
  });

  /* ── Non-Object Messages ─────────────────────────────────────────────── */

  describe('Non-Object Messages', () => {
    it('should reject string', () => {
      expect(isValidProtocolMessage('ready')).toBe(false);
    });

    it('should reject number', () => {
      expect(isValidProtocolMessage(42)).toBe(false);
    });

    it('should reject boolean', () => {
      expect(isValidProtocolMessage(true)).toBe(false);
    });

    it('should reject null', () => {
      expect(isValidProtocolMessage(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isValidProtocolMessage(undefined)).toBe(false);
    });

    it('should reject array', () => {
      expect(isValidProtocolMessage([1, 'ready'])).toBe(false);
    });
  });

  /* ── XSS / Injection in field values (passthrough) ───────────────────── */

  describe('XSS Payloads in Message Data', () => {
    /**
     * The protocol validator itself only checks structure, not content.
     * Content validation happens at field-level validators.
     * These tests document that malicious data passes protocol validation
     * but would be caught by form validators.
     */

    it('should accept message with XSS in data values (protocol level)', () => {
      const msg = {
        v: 1,
        command: 'submit',
        data: { name: '<script>alert(1)</script>' },
      };
      // Protocol doesn't validate data contents
      expect(isValidProtocolMessage(msg)).toBe(true);
    });

    it('should accept message with SQL injection in data values', () => {
      const msg = {
        v: 1,
        command: 'submit',
        data: { name: "'; DROP TABLE servers; --" },
      };
      expect(isValidProtocolMessage(msg)).toBe(true);
    });

    it('should accept message with null bytes', () => {
      const msg = {
        v: 1,
        command: 'submit',
        data: { name: 'test\x00hack' },
      };
      expect(isValidProtocolMessage(msg)).toBe(true);
    });
  });

  /* ── Prototype Pollution Attempts ────────────────────────────────────── */

  describe('Prototype Pollution', () => {
    it('should accept message with __proto__ key (protocol level)', () => {
      const msg = JSON.parse('{"v":1,"command":"submit","data":{"__proto__":{"polluted":true}}}');
      expect(isValidProtocolMessage(msg)).toBe(true);
      // Verify Object.prototype NOT polluted
      expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it('should accept message with constructor key', () => {
      const msg = { v: 1, command: 'submit', data: { constructor: { prototype: { x: 1 } } } };
      expect(isValidProtocolMessage(msg)).toBe(true);
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * escapeHtml — extracted logic from the legacy HTML-rendering path
 * ══════════════════════════════════════════════════════════════════════════ */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

describe('escapeHtml', () => {
  it('should escape ampersands', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('should escape less-than', () => {
    expect(escapeHtml('a<b')).toBe('a&lt;b');
  });

  it('should escape greater-than', () => {
    expect(escapeHtml('a>b')).toBe('a&gt;b');
  });

  it('should escape double quotes', () => {
    expect(escapeHtml('a"b')).toBe('a&quot;b');
  });

  it('should escape all at once', () => {
    expect(escapeHtml('<div class="x">&</div>')).toBe('&lt;div class=&quot;x&quot;&gt;&amp;&lt;/div&gt;');
  });

  it('should leave single quotes unescaped', () => {
    // Note: single quotes are NOT escaped — this is accurate CSP behavior
    // but could be a minor concern if titles are used in single-quoted attributes
    expect(escapeHtml("it's")).toBe("it's");
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should handle string with no special chars', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('should handle XSS injection pattern', () => {
    expect(escapeHtml('<img onerror="alert(1)" src=x>')).toBe(
      '&lt;img onerror=&quot;alert(1)&quot; src=x&gt;',
    );
  });

  it('should handle script tags', () => {
    expect(escapeHtml('<script>alert("XSS")</script>')).toBe(
      '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * DEPLOY_NAME_PATTERN validation
 * ══════════════════════════════════════════════════════════════════════════ */

import { DEPLOY_NAME_PATTERN } from '../../constants';

describe('DEPLOY_NAME_PATTERN', () => {

  describe('Valid deploy names', () => {
    const valid = [
      'myapp', 'ROOT', 'app1', 'my-app', 'my_app', 'my.app',
      'a', 'A', '0', '9',
      'app-v2.0', 'my_app_v3.1', 'app.war', 'test123',
      'app-name.with.dots-and_underscores',
    ];
    for (const name of valid) {
      it(`should accept: ${name}`, () => {
        expect(DEPLOY_NAME_PATTERN.test(name)).toBe(true);
      });
    }
  });

  describe('Invalid deploy names', () => {
    const invalid = [
      '', ' ', '-app', '_app', '.app',
      'app/path', 'app\\path', 'my app',
      '../../../etc/passwd', '..\\windows',
      'app<tag>', 'app"quote', "app'quote",
      'app;cmd', 'app|pipe', 'app&amp',
      'app\x00null', 'app\nnewline', 'app\ttab',
      'app:colon', 'app*glob', 'app?q',
    ];
    for (const name of invalid) {
      it(`should reject: ${JSON.stringify(name)}`, () => {
        expect(DEPLOY_NAME_PATTERN.test(name)).toBe(false);
      });
    }
  });

  describe('Security-relevant patterns', () => {
    it('should reject path traversal', () => {
      expect(DEPLOY_NAME_PATTERN.test('../../../etc/shadow')).toBe(false);
    });

    it('should reject Windows path traversal', () => {
      expect(DEPLOY_NAME_PATTERN.test('..\\..\\system32')).toBe(false);
    });

    it('should reject null byte injection', () => {
      expect(DEPLOY_NAME_PATTERN.test('app\x00.war')).toBe(false);
    });

    it('should reject command injection', () => {
      expect(DEPLOY_NAME_PATTERN.test('app;rm -rf /')).toBe(false);
    });

    it('should reject shell pipe', () => {
      expect(DEPLOY_NAME_PATTERN.test('app|cat /etc/passwd')).toBe(false);
    });

    it('should reject backtick injection', () => {
      expect(DEPLOY_NAME_PATTERN.test('app`whoami`')).toBe(false);
    });

    it('should reject $() command substitution', () => {
      expect(DEPLOY_NAME_PATTERN.test('app$(whoami)')).toBe(false);
    });
  });
});
