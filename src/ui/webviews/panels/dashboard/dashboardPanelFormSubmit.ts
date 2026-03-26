import {
  formDataToServerConfig,
  formDataToTemplateDraft,
  templateDraftToTemplate,
  validateServerForm,
} from '@core/authoring';
import { v4 as uuid } from 'uuid';
import type { ServerTemplate } from '@core/types';
import type { HostToWebview } from '../../protocol';
import { WEBVIEW_PROTOCOL_VERSION } from '../../protocol';
import type { DashboardPanelDeps } from './dashboardPanelTypes';

export async function submitServerConfigForm(params: {
  deps: DashboardPanelDeps;
  lastSubmittedData: Record<string, unknown> | undefined;
  currentFormTargetId?: string;
  currentFormTargetWorkspaceFolderUri?: string;
  postError: (message: string) => void;
  postMessage: (msg: HostToWebview) => void;
  syncState: () => void;
  onClearLastSubmitted: () => void;
}): Promise<void> {
  const {
    deps,
    lastSubmittedData,
    currentFormTargetId,
    currentFormTargetWorkspaceFolderUri,
    postError,
    postMessage,
    syncState,
    onClearLastSubmitted,
  } = params;

  if (!lastSubmittedData) {
    postError('No form data received.');
    return;
  }

  const errors = validateServerForm(lastSubmittedData);
  if (errors.length > 0) {
    postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'validationErrors',
      errors,
    });
    return;
  }

  if (!currentFormTargetId || !currentFormTargetWorkspaceFolderUri) {
    postError('Server target not found.');
    return;
  }

  const record = deps.workspaceRegistry.getAllServers().find(item =>
    item.serverId === currentFormTargetId
    && item.workspaceFolderUri === currentFormTargetWorkspaceFolderUri,
  );
  if (!record) {
    postError('Server not found.');
    return;
  }

  const result = await deps.workspaceRegistry.updateServer(
    {
      workspaceFolderUri: record.workspaceFolderUri,
      serverId: record.serverId,
    },
    formDataToServerConfig(lastSubmittedData, record.config),
  );
  onClearLastSubmitted();

  if (!result.ok) {
    postError(result.error.message);
    return;
  }

  syncState();
}

export async function submitTemplateConfigForm(params: {
  deps: DashboardPanelDeps;
  lastSubmittedData: Record<string, unknown> | undefined;
  currentFormMode?: 'create' | 'edit';
  currentFormTargetId?: string;
  currentFormTargetScope?: 'global' | 'workspace';
  postError: (message: string) => void;
  postMessage: (msg: HostToWebview) => void;
  syncState: () => void;
  onClearLastSubmitted: () => void;
}): Promise<void> {
  const {
    deps,
    lastSubmittedData,
    currentFormMode,
    currentFormTargetId,
    currentFormTargetScope,
    postError,
    postMessage,
    syncState,
    onClearLastSubmitted,
  } = params;

  if (!lastSubmittedData) {
    postError('No form data received.');
    return;
  }

  const templateId = currentFormMode === 'edit' ? currentFormTargetId : undefined;

  const existingEntry = templateId
    ? deps.templateService.listScoped().find(item => item.template.id === templateId)
    : undefined;

  const validationErrors: Array<{ field: string; message: string }> = [];
  if (String(lastSubmittedData['name'] ?? '').trim().length === 0) {
    validationErrors.push({
      field: 'name',
      message: 'Template name is required.',
    });
  }
  if (validationErrors.length > 0) {
    postMessage({
      v: WEBVIEW_PROTOCOL_VERSION,
      command: 'validationErrors',
      errors: validationErrors,
    });
    return;
  }

  const templateDraft = formDataToTemplateDraft(lastSubmittedData, {
    fallbackScope: existingEntry?.scope ?? currentFormTargetScope ?? 'workspace',
    fallbackPluginType: existingEntry?.template.pluginType ?? 'tomcat',
  });
  const template = templateDraftToTemplate({
    id: existingEntry?.template.id ?? uuid(),
    draft: templateDraft,
  });

  // Strip any non-plain values (e.g. accidental proxies) before persistence / webview sync serialization.
  let toSave: ServerTemplate;
  try {
    toSave = JSON.parse(JSON.stringify(template)) as ServerTemplate;
  } catch (e) {
    postError(`Template data could not be serialized: ${String(e)}`);
    return;
  }

  const result = await deps.templateService.save(toSave, templateDraft.scope);
  onClearLastSubmitted();

  if (!result.ok) {
    postError(result.error.message);
    return;
  }

  syncState();
}
