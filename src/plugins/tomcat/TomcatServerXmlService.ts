import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { SslConfig, Logger } from '@core/types';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';
import { DEFAULT_TRUSTSTORE_TYPE, DEFAULT_SSL_PROTOCOLS, DEFAULT_SSL_CIPHERS } from '../../constants';

/** Parsed XML node in fast-xml-parser preserveOrder format. */
type XmlNode = Record<string, unknown>;

/** Parsed XML document (array of root nodes). */
type XmlDocument = XmlNode[];

/** Predicate for filtering XML nodes. */
type NodePredicate = (node: XmlNode) => boolean;

export class TomcatServerXmlService {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // ── Helpers ─────────────────────────────────────────────

  private parse(xml: string): XmlDocument {
    const parser = new XMLParser({
      ignoreAttributes: false,
      preserveOrder: true,
      commentPropName: '#comment',
    });
    return parser.parse(xml);
  }

  private build(doc: XmlDocument): string {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      preserveOrder: true,
      commentPropName: '#comment',
      format: true,
      indentBy: '  ',
      suppressEmptyNode: true,
    });
    return builder.build(doc);
  }

  /** Find <Service name="Catalina"> in a parsed document. */
  private findService(doc: XmlDocument): XmlNode | undefined {
    for (const node of doc) {
      if (typeof node !== 'object' || node === null) continue;

      if (node['Server']) {
        const serverChildren = node['Server'] as XmlNode[];
        if (!Array.isArray(serverChildren)) continue;

        for (const child of serverChildren) {
          if (typeof child !== 'object' || child === null) continue;
          if (child['Service']) {
            const attrs = child[':@'] as Record<string, unknown> | undefined;
            if (attrs?.['@_name'] === 'Catalina') {
              return child;
            }
          }
        }
      }

      // Recurse into children
      for (const key of Object.keys(node)) {
        if (key === ':@') continue;
        if (Array.isArray(node[key])) {
          const found = this.findService(node[key] as XmlDocument);
          if (found) return found;
        }
      }
    }
    return undefined;
  }

  /**
   * Get the children array of an element node.
   * For a node like { Service: [...], ':@': {...} }, returns the array.
   */
  private getElementChildren(node: XmlNode): XmlNode[] {
    // Find the first non-:@ key that has an array value
    for (const key of Object.keys(node)) {
      if (key === ':@') continue;
      if (Array.isArray(node[key])) {
        return node[key] as XmlNode[];
      }
    }
    return [];
  }

  /** Remove children matching a predicate. Returns count of removed nodes. */
  private removeChildren(parent: XmlNode, predicate: NodePredicate): number {
    const children = this.getElementChildren(parent);
    const originalLength = children.length;

    const filtered = children.filter((child: unknown) => {
      if (typeof child !== 'object' || child === null) return true;
      return !predicate(child as XmlNode);
    });

    // Write back to the same key
    for (const key of Object.keys(parent)) {
      if (key === ':@') continue;
      if (Array.isArray(parent[key])) {
        parent[key] = filtered;
        break;
      }
    }

    return originalLength - filtered.length;
  }

  /** Insert a node before the first child matching a predicate. Appends if no match. */
  private insertBefore(parent: XmlNode, predicate: NodePredicate, node: XmlNode): void {
    const children = this.getElementChildren(parent);
    const index = children.findIndex((child: unknown) => {
      if (typeof child !== 'object' || child === null) return false;
      return predicate(child as XmlNode);
    });

    if (index >= 0) {
      children.splice(index, 0, node);
    } else {
      children.push(node);
    }
  }

  /** Build a node in preserveOrder format. */
  private buildNode(
    elementName: string,
    attrs: Record<string, string>,
    children: XmlNode[] = [],
  ): XmlNode {
    return {
      ':@': attrs,
      [elementName]: children,
    };
  }

  // ── Feature: SSL ────────────────────────────────────────────────────

  /**
   * Patch server.xml to add or remove the SSL connector.
   * Owns the full lifecycle: parse → find Service → remove old SSL connectors → add new → build.
   */
  patchSsl(serverXml: string, ssl: SslConfig | undefined): string {
    const doc = this.parse(serverXml);

    const service = this.findService(doc);
    if (!service) {
      this.logger.warn('TomcatServerXmlService: <Service name="Catalina"> not found, skipping SSL patch');
      return serverXml;
    }

    // Remove all existing SSL connectors (idempotent)
    this.removeChildren(service, (node) => {
      if (!('Connector' in node)) return false;
      const attrs = node[':@'] as Record<string, unknown> | undefined;
      return attrs?.['@_SSLEnabled'] === 'true' || attrs?.['@_SSLEnabled'] === true;
    });

    // Add SSL connector if enabled
    if (ssl?.enabled) {
      const connector = this.buildSslConnector(ssl);
      this.insertBefore(service, (node) => 'Engine' in node, connector);
    }

    return this.build(doc);
  }

  /** Remove AJP connectors when disabled. */
  patchAjp(serverXml: string, disableAjp: boolean): string {
    if (!disableAjp) {
      return serverXml;
    }

    const doc = this.parse(serverXml);
    const service = this.findService(doc);
    if (!service) {
      throw new JsmError({
        code: ErrorCode.InvalidConfig,
        message: 'TomcatServerXmlService: <Service name="Catalina"> not found while disableAjp is enabled',
      });
    }

    this.removeChildren(service, (node) => {
      if (!('Connector' in node)) return false;
      const attrs = node[':@'] as Record<string, unknown> | undefined;
      const protocol = String(attrs?.['@_protocol'] ?? '');
      return protocol.toUpperCase().startsWith('AJP/');
    });

    return this.build(doc);
  }

  /**
   * Patch AJP and SSL connector state in a single parse/build pass.
   * Preserves the same semantics as patchAjp(...)->patchSsl(...).
   */
  patchConnectors(
    serverXml: string,
    options: { disableAjp: boolean; ssl: SslConfig | undefined },
  ): string {
    const { disableAjp, ssl } = options;
    if (!disableAjp && !ssl) {
      return serverXml;
    }

    const doc = this.parse(serverXml);
    const service = this.findService(doc);
    if (!service) {
      if (disableAjp) {
        throw new JsmError({
          code: ErrorCode.InvalidConfig,
          message: 'TomcatServerXmlService: <Service name="Catalina"> not found while disableAjp is enabled',
        });
      }
      this.logger.warn('TomcatServerXmlService: <Service name="Catalina"> not found, skipping SSL patch');
      return serverXml;
    }

    if (disableAjp) {
      this.removeChildren(service, (node) => {
        if (!('Connector' in node)) return false;
        const attrs = node[':@'] as Record<string, unknown> | undefined;
        const protocol = String(attrs?.['@_protocol'] ?? '');
        return protocol.toUpperCase().startsWith('AJP/');
      });
    }

    this.removeChildren(service, (node) => {
      if (!('Connector' in node)) return false;
      const attrs = node[':@'] as Record<string, unknown> | undefined;
      return attrs?.['@_SSLEnabled'] === 'true' || attrs?.['@_SSLEnabled'] === true;
    });

    if (ssl?.enabled) {
      const connector = this.buildSslConnector(ssl);
      this.insertBefore(service, (node) => 'Engine' in node, connector);
    }

    return this.build(doc);
  }

  /** Build the SSL Connector node tree. */
  private buildSslConnector(ssl: SslConfig): XmlNode {
    const keystoreExt = ssl.keystoreType === 'JKS' ? 'jks' : 'p12';
    const keystorePath = `conf/keystore.${keystoreExt}`;
    const protocols = ssl.protocols?.join(',') ?? DEFAULT_SSL_PROTOCOLS.join(',');
    const ciphers = ssl.ciphers ?? DEFAULT_SSL_CIPHERS;

    // Certificate element
    const certAttrs: Record<string, string> = {
      '@_certificateKeystoreFile': keystorePath,
      '@_certificateKeystorePassword': ssl.keystorePassword,
      '@_certificateKeystoreType': ssl.keystoreType,
      '@_type': 'RSA',
    };
    if (ssl.keyAlias) {
      certAttrs['@_certificateKeyAlias'] = ssl.keyAlias;
    }
    if (ssl.keyPassword && ssl.keyPassword !== ssl.keystorePassword) {
      certAttrs['@_certificateKeyPassword'] = ssl.keyPassword;
    }
    const certificate = this.buildNode('Certificate', certAttrs);

    // SSLHostConfig element
    const sslHostConfigAttrs: Record<string, string> = {
      '@_protocols': protocols,
      '@_honorCipherOrder': 'true',
      '@_ciphers': ciphers,
    };
    if (ssl.clientAuth && ssl.truststorePath) {
      const truststoreExt = (ssl.truststoreType ?? DEFAULT_TRUSTSTORE_TYPE) === 'JKS' ? 'jks' : 'p12';
      sslHostConfigAttrs['@_certificateVerification'] = 'required';
      sslHostConfigAttrs['@_truststoreFile'] = `conf/truststore.${truststoreExt}`;
      sslHostConfigAttrs['@_truststorePassword'] = ssl.truststorePassword ?? '';
      sslHostConfigAttrs['@_truststoreType'] = ssl.truststoreType ?? DEFAULT_TRUSTSTORE_TYPE;
    }
    const sslHostConfig = this.buildNode('SSLHostConfig', sslHostConfigAttrs, [certificate]);

    // Connector element
    const connectorAttrs: Record<string, string> = {
      '@_port': String(ssl.port),
      '@_protocol': 'org.apache.coyote.http11.Http11NioProtocol',
      '@_maxThreads': '150',
      '@_SSLEnabled': 'true',
      '@_scheme': 'https',
      '@_secure': 'true',
    };

    return this.buildNode('Connector', connectorAttrs, [sslHostConfig]);
  }
}
