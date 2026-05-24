import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  basenameForDeploymentSource,
  inferDeploymentContextPath,
} from '@ui/webviews/client/components/spa/forms/deploymentWizardModel';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('deployment wizard context path inference', () => {
  it('infers an initial context path from an exploded source directory', () => {
    expect(inferDeploymentContextPath({
      sourcePath: '/workspace/apps/customer-portal',
      deployName: '',
      lastInferredName: '',
      deployNameUserEdited: false,
    })).toEqual({
      deployName: 'customer-portal',
      lastInferredName: 'customer-portal',
      changed: true,
    });
  });

  it('infers an initial context path from a WAR file and strips .war case-insensitively', () => {
    expect(inferDeploymentContextPath({
      sourcePath: 'C:\\build\\Inventory.WAR',
      deployName: '',
      lastInferredName: '',
      deployNameUserEdited: false,
    })).toEqual({
      deployName: 'Inventory',
      lastInferredName: 'Inventory',
      changed: true,
    });
  });

  it('keeps following the source path while the current value is still the previous suggestion', () => {
    expect(inferDeploymentContextPath({
      sourcePath: '/workspace/apps/new-service',
      deployName: 'old-service',
      lastInferredName: 'old-service',
      deployNameUserEdited: false,
    })).toEqual({
      deployName: 'new-service',
      lastInferredName: 'new-service',
      changed: true,
    });
  });

  it('preserves a custom context path when the source path changes', () => {
    expect(inferDeploymentContextPath({
      sourcePath: '/workspace/apps/new-service',
      deployName: 'public-api',
      lastInferredName: 'old-service',
      deployNameUserEdited: true,
    })).toEqual({
      deployName: 'public-api',
      lastInferredName: 'old-service',
      changed: false,
    });
  });

  it('preserves an intentionally cleared context path instead of restoring the suggestion', () => {
    expect(inferDeploymentContextPath({
      sourcePath: '/workspace/apps/customer-portal',
      deployName: '',
      lastInferredName: 'customer-portal',
      deployNameUserEdited: true,
    })).toEqual({
      deployName: '',
      lastInferredName: 'customer-portal',
      changed: false,
    });
  });

  it('does not infer from an empty source path', () => {
    expect(inferDeploymentContextPath({
      sourcePath: '',
      deployName: '',
      lastInferredName: '',
      deployNameUserEdited: false,
    })).toEqual({
      deployName: '',
      lastInferredName: '',
      changed: false,
    });
  });

  it.each([
    ['/workspace/apps/customer-portal/', 'customer-portal'],
    ['/workspace/apps/customer-portal.war', 'customer-portal'],
    ['/workspace/apps/customer-portal.WAR', 'customer-portal'],
    ['C:\\workspace\\apps\\billing-api\\', 'billing-api'],
    ['relative/path/admin-console', 'admin-console'],
  ])('derives basename for %s', (sourcePath, expected) => {
    expect(basenameForDeploymentSource(sourcePath)).toBe(expected);
  });

  it('wires the deployment wizard input to manual-edit tracking', () => {
    const src = readSource('src/ui/webviews/client/components/spa/forms/DeploymentWizard.svelte');

    expect(src).toContain('deployNameUserEdited = true');
    expect(src).toContain('inferDeploymentContextPath');
    expect(src).toContain('oninput={handleDeployNameInput}');
    expect(src).toContain('deployNameUserEdited = snapshot.deployNameUserEdited ?? false');
  });
});
