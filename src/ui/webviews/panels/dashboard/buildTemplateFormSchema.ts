import type { PluginRegistry } from '@plugins/registry/PluginRegistry';
import type { FormSchema, HookTaskOption } from '../../protocol';

export function buildTemplateFormSchema(
  pluginRegistry: PluginRegistry,
  hookTaskOptions: HookTaskOption[],
): FormSchema {
  const supportedTypes = pluginRegistry.getSupportedTypes();
  const typeOptions = supportedTypes.map(type => ({
    value: type,
    label: pluginRegistry.get(type)?.getUIMetadata().displayName ?? type,
  }));

  return {
    title: 'Template',
    sections: [
      {
        id: 'details',
        title: 'Details',
        fields: [
          {
            name: 'name',
            label: 'Template Name',
            type: 'text',
            required: true,
            placeholder: 'My Template',
          },
          {
            name: 'description',
            label: 'Description',
            type: 'textarea',
          },
          {
            name: 'scope',
            label: 'Scope',
            type: 'select',
            required: true,
            defaultValue: 'workspace',
            options: [
              { value: 'workspace', label: 'Workspace' },
              { value: 'global', label: 'Global' },
            ],
          },
          {
            name: 'pluginType',
            label: 'Server Type',
            type: 'select',
            required: true,
            defaultValue: typeOptions[0]?.value ?? 'tomcat',
            options: typeOptions,
          },
        ],
      },
      {
        id: 'defaults',
        title: 'Defaults',
        fields: [
          {
            name: 'runtime.homePath',
            label: 'Runtime Home',
            type: 'path',
            helpText: 'Optional default runtime home for servers created from this template.',
          },
          {
            name: 'javaHome',
            label: 'JAVA_HOME',
            type: 'path',
            helpText: 'Optional default JDK path for servers created from this template.',
          },
          {
            name: 'host',
            label: 'Host',
            type: 'text',
            defaultValue: '127.0.0.1',
            helpText: 'Optional default host for servers created from this template.',
          },
          {
            name: 'ports.http',
            label: 'HTTP Port',
            type: 'port',
            defaultValue: 8080,
            helpText: 'Optional default HTTP port for servers created from this template.',
          },
          {
            name: 'ports.debug',
            label: 'Debug Port',
            type: 'port',
            defaultValue: 5005,
            helpText: 'Optional default debug port for servers created from this template.',
          },
          {
            name: 'run.vmArgs',
            label: 'JVM Arguments',
            type: 'tags',
            helpText: 'Optional default JVM arguments for servers created from this template.',
          },
          {
            name: 'debug.bind',
            label: 'Debug Bind',
            type: 'select',
            defaultValue: '127.0.0.1',
            options: [
              { value: '127.0.0.1', label: '127.0.0.1' },
              { value: 'localhost', label: 'localhost' },
              { value: '::1', label: '::1' },
            ],
          },
          {
            name: 'hooks',
            label: 'Hooks',
            type: 'hooks',
            defaultValue: [],
            helpText: 'Default hooks applied to servers created from this template.',
            hookOptions: {
              taskOptions: hookTaskOptions,
            },
          },
        ],
      },
      {
        id: 'ssl',
        title: 'SSL/TLS',
        collapsible: true,
        fields: [
          {
            name: 'pluginConfig.ssl.enabled',
            label: 'Enable SSL/HTTPS',
            type: 'checkbox',
            defaultValue: false,
            visibleWhen: { field: 'pluginType', equals: 'tomcat' },
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
        ],
      },
    ],
  };
}
