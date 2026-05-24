export interface DeploymentContextPathInferenceInput {
  sourcePath: string;
  deployName: string;
  lastInferredName: string;
  deployNameUserEdited: boolean;
}

export interface DeploymentContextPathInferenceResult {
  deployName: string;
  lastInferredName: string;
  changed: boolean;
}

export function basenameForDeploymentSource(sourcePath: string): string {
  const trimmedPath = sourcePath.trim().replace(/[\\/]+$/, '');
  if (!trimmedPath) {
    return '';
  }

  return trimmedPath.split(/[/\\]/).pop()?.replace(/\.war$/i, '') ?? '';
}

export function inferDeploymentContextPath(
  input: DeploymentContextPathInferenceInput,
): DeploymentContextPathInferenceResult {
  const basename = basenameForDeploymentSource(input.sourcePath);
  if (!basename || input.deployNameUserEdited) {
    return {
      deployName: input.deployName,
      lastInferredName: input.lastInferredName,
      changed: false,
    };
  }

  const hasCustomValue = input.deployName.trim().length > 0 && input.deployName !== input.lastInferredName;
  if (hasCustomValue) {
    return {
      deployName: input.deployName,
      lastInferredName: input.lastInferredName,
      changed: false,
    };
  }

  if (input.deployName === basename && input.lastInferredName === basename) {
    return {
      deployName: input.deployName,
      lastInferredName: input.lastInferredName,
      changed: false,
    };
  }

  return {
    deployName: basename,
    lastInferredName: basename,
    changed: true,
  };
}
