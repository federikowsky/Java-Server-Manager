import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildDirtySettingsPayload,
  hasDirtySettings,
  type EditableSettings,
} from '@ui/webviews/client/settingsPayload';

const baseline: EditableSettings = {
  defaultHttpPort: 8080,
  defaultDebugPort: 5005,
  defaultJavaHome: '',
  showStatusInSidebar: true,
  localTelemetryEnabled: false,
};

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('settings dirty payload', () => {
  it('returns an empty payload when no setting changed', () => {
    const payload = buildDirtySettingsPayload({ ...baseline }, baseline);

    expect(payload).toEqual({});
    expect(hasDirtySettings(payload)).toBe(false);
  });

  it('sends only Default Java Home when that is the only changed setting', () => {
    const payload = buildDirtySettingsPayload({
      ...baseline,
      defaultJavaHome: '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
    }, baseline);

    expect(payload).toEqual({
      defaultJavaHome: '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
    });
    expect(payload).not.toHaveProperty('showStatusInSidebar');
    expect(payload).not.toHaveProperty('defaultHttpPort');
    expect(payload).not.toHaveProperty('defaultDebugPort');
    expect(payload).not.toHaveProperty('localTelemetryEnabled');
    expect(hasDirtySettings(payload)).toBe(true);
  });

  it('includes an empty Default Java Home when the user clears a previously configured value', () => {
    const previous = { ...baseline, defaultJavaHome: '/jdk' };

    expect(buildDirtySettingsPayload({ ...previous, defaultJavaHome: '' }, previous)).toEqual({
      defaultJavaHome: '',
    });
  });

  it('includes changed numeric defaults without rewriting unchanged UI preferences', () => {
    const payload = buildDirtySettingsPayload({
      ...baseline,
      defaultHttpPort: 8181,
      defaultDebugPort: 5101,
    }, baseline);

    expect(payload).toEqual({
      defaultHttpPort: 8181,
      defaultDebugPort: 5101,
    });
  });

  it('includes changed boolean preferences only when they are actually toggled', () => {
    const payload = buildDirtySettingsPayload({
      ...baseline,
      showStatusInSidebar: false,
      localTelemetryEnabled: true,
    }, baseline);

    expect(payload).toEqual({
      showStatusInSidebar: false,
      localTelemetryEnabled: true,
    });
  });

  it('can represent a mixed settings update without adding untouched keys', () => {
    const payload = buildDirtySettingsPayload({
      ...baseline,
      defaultJavaHome: '/jdk',
      localTelemetryEnabled: true,
    }, baseline);

    expect(payload).toEqual({
      defaultJavaHome: '/jdk',
      localTelemetryEnabled: true,
    });
  });

  it('wires the settings view save action to the dirty payload helper', () => {
    const src = readSource('src/ui/webviews/client/components/spa/SettingsView.svelte');

    expect(src).toContain('buildDirtySettingsPayload');
    expect(src).toContain('const payload = buildDirtySettingsPayload');
    expect(src).toContain('args: [payload]');
  });

  it('exposes team setup recipe import and export from settings', () => {
    const src = readSource('src/ui/webviews/client/components/spa/SettingsView.svelte');

    expect(src).toContain('Team Setup Recipes');
    expect(src).toContain("id: 'jsm.recipe.export'");
    expect(src).toContain("id: 'jsm.recipe.import'");
  });

  it('exposes environment profile import and export from settings', () => {
    const src = readSource('src/ui/webviews/client/components/spa/SettingsView.svelte');

    expect(src).toContain('Environment Profiles');
    expect(src).toContain("id: 'jsm.envProfile.export'");
    expect(src).toContain("id: 'jsm.envProfile.import'");
  });
});
