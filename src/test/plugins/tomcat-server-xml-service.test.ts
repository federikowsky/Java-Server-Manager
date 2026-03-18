import { describe, it, expect } from 'vitest';
import { TomcatServerXmlService } from '@plugins/tomcat/TomcatServerXmlService';
import type { SslConfig, Logger } from '@core/types';

// ── Helpers ─────────────────────────────────────────────────────────────────

function noopLogger(): Logger {
  const noop = () => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => noopLogger(),
  };
}

const TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<Server port="\${shutdown.port}" shutdown="\${shutdown.command}">
  <Service name="Catalina">
    <Connector port="\${http.port}" protocol="HTTP/1.1"
               connectionTimeout="20000"
               redirectPort="\${https.port:8443}" />
    <Engine name="Catalina" defaultHost="localhost">
      <Host name="localhost" appBase="webapps"
            unpackWARs="true" autoDeploy="true">
      </Host>
    </Engine>
  </Service>
</Server>`;

function sslConfig(overrides: Partial<SslConfig> = {}): SslConfig {
  return {
    enabled: true,
    port: 8443,
    keystorePath: '/path/to/keystore.p12',
    keystorePassword: 'changeit',
    keystoreType: 'PKCS12',
    clientAuth: false,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('TomcatServerXmlService — patchSsl', () => {
  const service = new TomcatServerXmlService(noopLogger());

  it('adds SSL connector when ssl.enabled is true', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig());

    expect(result).toContain('SSLEnabled="true"');
    expect(result).toContain('port="8443"');
    expect(result).toContain('certificateKeystoreFile="conf/keystore.p12"');
    expect(result).toContain('certificateKeystorePassword="changeit"');
    expect(result).toContain('certificateKeystoreType="PKCS12"');
    expect(result).toContain('SSLHostConfig');
    expect(result).toContain('Certificate');
  });

  it('does not add SSL connector when ssl is undefined', () => {
    const result = service.patchSsl(TEMPLATE, undefined);

    expect(result).not.toContain('SSLEnabled="true"');
    expect(result).not.toContain('SSLHostConfig');
    // Original HTTP connector should still be present
    expect(result).toContain('port="${http.port}"');
  });

  it('does not add SSL connector when ssl.enabled is false', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig({ enabled: false }));

    expect(result).not.toContain('SSLEnabled="true"');
    expect(result).not.toContain('SSLHostConfig');
  });

  it('uses JKS extension when keystoreType is JKS', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig({ keystoreType: 'JKS' }));

    expect(result).toContain('certificateKeystoreFile="conf/keystore.jks"');
    expect(result).toContain('certificateKeystoreType="JKS"');
  });

  it('includes keyAlias when provided', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig({ keyAlias: 'mykey' }));

    expect(result).toContain('certificateKeyAlias="mykey"');
  });

  it('does not include keyAlias when not provided', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig());

    expect(result).not.toContain('certificateKeyAlias');
  });

  it('includes keyPassword when different from keystorePassword', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig({ keyPassword: 'keypass' }));

    expect(result).toContain('certificateKeyPassword="keypass"');
  });

  it('does not include keyPassword when same as keystorePassword', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig({ keyPassword: 'changeit' }));

    expect(result).not.toContain('certificateKeyPassword');
  });

  it('includes truststore config when clientAuth is true', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig({
      clientAuth: true,
      truststorePath: '/path/to/truststore.p12',
      truststorePassword: 'trustpass',
      truststoreType: 'PKCS12',
    }));

    expect(result).toContain('certificateVerification="required"');
    expect(result).toContain('truststoreFile="conf/truststore.p12"');
    expect(result).toContain('truststorePassword="trustpass"');
    expect(result).toContain('truststoreType="PKCS12"');
  });

  it('does not include truststore config when clientAuth is false', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig({ clientAuth: false }));

    expect(result).not.toContain('certificateVerification');
    expect(result).not.toContain('truststoreFile');
  });

  it('uses custom protocols when provided', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig({ protocols: ['TLSv1.3'] }));

    expect(result).toContain('protocols="TLSv1.3"');
  });

  it('uses default protocols when not provided', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig());

    expect(result).toContain('protocols="TLSv1.2,TLSv1.3"');
  });

  it('uses custom ciphers when provided', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig({ ciphers: 'HIGH:!aNULL' }));

    expect(result).toContain('ciphers="HIGH:!aNULL"');
  });

  it('preserves original HTTP connector', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig());

    expect(result).toContain('port="${http.port}"');
    expect(result).toContain('protocol="HTTP/1.1"');
    expect(result).toContain('connectionTimeout="20000"');
  });

  it('preserves Engine and Host elements', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig());

    expect(result).toContain('<Engine name="Catalina"');
    expect(result).toContain('<Host name="localhost"');
    expect(result).toContain('appBase="webapps"');
  });

  it('inserts SSL connector before Engine', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig());

    const sslIndex = result.indexOf('SSLEnabled="true"');
    const engineIndex = result.indexOf('<Engine');
    expect(sslIndex).toBeLessThan(engineIndex);
    expect(sslIndex).toBeGreaterThan(-1);
    expect(engineIndex).toBeGreaterThan(-1);
  });

  it('is idempotent — running twice produces same result', () => {
    const ssl = sslConfig();
    const first = service.patchSsl(TEMPLATE, ssl);
    const second = service.patchSsl(first, ssl);

    expect(second).toBe(first);
  });

  it('removes SSL connector when disabling after enabling', () => {
    const enabled = service.patchSsl(TEMPLATE, sslConfig());
    const disabled = service.patchSsl(enabled, sslConfig({ enabled: false }));

    expect(disabled).not.toContain('SSLEnabled="true"');
    expect(disabled).not.toContain('SSLHostConfig');
  });

  it('returns original XML when Service not found', () => {
    const badXml = '<?xml version="1.0"?><Server><Service name="Other"><Engine/></Service></Server>';
    const result = service.patchSsl(badXml, sslConfig());

    expect(result).toBe(badXml);
  });

  it('uses HTTPS port from config', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig({ port: 9443 }));

    expect(result).toContain('port="9443"');
  });

  it('sets scheme and secure attributes', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig());

    expect(result).toContain('scheme="https"');
    expect(result).toContain('secure="true"');
  });

  it('uses NIO protocol', () => {
    const result = service.patchSsl(TEMPLATE, sslConfig());

    expect(result).toContain('protocol="org.apache.coyote.http11.Http11NioProtocol"');
  });
});
