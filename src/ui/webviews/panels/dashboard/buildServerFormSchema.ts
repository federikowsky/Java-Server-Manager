import type { FormSchema, HookTaskOption } from '../../protocol';

export interface ServerFormUiMeta {
  displayName?: string;
  runtimeHomeLabel?: string;
  runtimeHomeHelp?: string;
  defaultName?: string;
}

export function buildServerFormSchema(params: {
  mode: 'create' | 'edit';
  uiMeta: ServerFormUiMeta | undefined;
  supportsSsl: boolean | undefined;
  hookTaskOptions: HookTaskOption[];
  defaultHttpPort: number;
}): FormSchema {
  const { mode, uiMeta, supportsSsl, hookTaskOptions, defaultHttpPort } = params;
  const displayName = uiMeta?.displayName ?? 'Server';

  return {
    title: mode === 'create' ? `Add ${displayName}` : `Edit ${displayName}`,
    sections: [
      {
        id: 'runtime',
        title: 'Runtime',
        fields: [
          {
            name: 'runtime.homePath',
            label: `Server Home (${uiMeta?.runtimeHomeLabel ?? 'Server Home'})`,
            type: 'path',
            required: true,
            browse: { kind: 'directory' },
            actionButtons: [
              { id: 'autodiscover', icon: 'search', title: 'Autodiscover Server Installation' },
            ],
            helpText: uiMeta?.runtimeHomeHelp ?? 'Absolute path to the server installation directory.',
          },
        ],
      },
      {
        id: 'identity',
        title: 'Server Identity',
        fields: [
          {
            name: 'name',
            label: 'Server Name',
            type: 'text',
            required: true,
            placeholder: uiMeta?.defaultName ?? 'My Server',
          },
          {
            name: 'ports.http',
            label: 'HTTP Port',
            type: 'port',
            required: true,
            defaultValue: defaultHttpPort,
            validation: { min: 1, max: 65535 },
          },
        ],
      },
      {
        id: 'java',
        title: 'Java',
        fields: [
          {
            name: 'javaHome',
            label: 'JAVA_HOME',
            type: 'path',
            required: true,
            browse: { kind: 'directory' },
            helpText: 'Path to JDK installation. Must contain bin/java.',
          },
        ],
      },
      {
        id: 'advanced',
        title: 'Advanced',
        collapsible: true,
        fields: [
          {
            name: 'host',
            label: 'Bind Host',
            type: 'text',
            defaultValue: '127.0.0.1',
          },
          {
            name: 'run.vmArgs',
            label: 'VM Arguments',
            type: 'tags',
            helpText: 'JVM arguments (one per tag).',
          },
          {
            name: 'debug.bind',
            label: 'Debug Bind Address',
            type: 'select',
            defaultValue: '127.0.0.1',
            options: [
              { value: '127.0.0.1', label: '127.0.0.1' },
              { value: 'localhost', label: 'localhost' },
              { value: '::1', label: '::1' },
            ],
          },
          {
            name: 'ports.debug',
            label: 'Debug Port',
            type: 'port',
            helpText: 'Optional. Leave empty to auto-assign a free port.',
            validation: { min: 1, max: 65535 },
          },
          {
            name: 'hooks',
            label: 'Hooks',
            type: 'hooks',
            defaultValue: [],
            helpText: 'Configure server hooks as terminal commands or VS Code tasks.',
            hookOptions: {
              taskOptions: hookTaskOptions,
            },
          },
        ],
      },
      ...(supportsSsl
        ? [{
          id: 'ssl',
          title: 'SSL/TLS',
          collapsible: true,
          fields: [
            {
              name: 'pluginConfig.ssl.enabled',
              label: 'Enable SSL/HTTPS',
              type: 'checkbox',
              defaultValue: false,
            },
            {
              name: 'pluginConfig.ssl.port',
              label: 'HTTPS Port',
              type: 'port',
              defaultValue: 8443,
              validation: { min: 1, max: 65535 },
              visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
            },
            {
              name: 'pluginConfig.ssl.keystorePath',
              label: 'Keystore File',
              type: 'path',
              browse: { kind: 'file', filters: { Keystore: ['p12', 'pfx', 'jks'] } },
              visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
            },
            {
              name: 'pluginConfig.ssl.keystorePassword',
              label: 'Keystore Password',
              type: 'password',
              visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
            },
            {
              name: 'pluginConfig.ssl.keystoreType',
              label: 'Keystore Type',
              type: 'select',
              defaultValue: 'PKCS12',
              options: [
                { value: 'PKCS12', label: 'PKCS12 (recommended)' },
                { value: 'JKS', label: 'JKS' },
              ],
              visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
            },
            {
              name: 'pluginConfig.ssl.keyAlias',
              label: 'Key Alias',
              type: 'text',
              visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
            },
            {
              name: 'pluginConfig.ssl.clientAuth',
              label: 'Client Certificate Authentication (mTLS)',
              type: 'checkbox',
              defaultValue: false,
              visibleWhen: { field: 'pluginConfig.ssl.enabled', equals: true },
            },
            {
              name: 'pluginConfig.ssl.truststorePath',
              label: 'Truststore File',
              type: 'path',
              browse: { kind: 'file', filters: { Truststore: ['p12', 'pfx', 'jks'] } },
              visibleWhen: { field: 'pluginConfig.ssl.clientAuth', equals: true },
            },
            {
              name: 'pluginConfig.ssl.truststorePassword',
              label: 'Truststore Password',
              type: 'password',
              visibleWhen: { field: 'pluginConfig.ssl.clientAuth', equals: true },
            },
            {
              name: 'pluginConfig.ssl.truststoreType',
              label: 'Truststore Type',
              type: 'select',
              defaultValue: 'PKCS12',
              options: [
                { value: 'PKCS12', label: 'PKCS12 (recommended)' },
                { value: 'JKS', label: 'JKS' },
              ],
              visibleWhen: { field: 'pluginConfig.ssl.clientAuth', equals: true },
            },
          ],
        } as FormSchema['sections'][number]] : []),
    ],
  };
}
