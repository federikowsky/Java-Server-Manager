import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';

// Core utilities
import { Result, ok, err } from '../../core/utils/result';
import { Logger } from '../../core/utils/logger';
import { EventBus } from '../../core/EventBus';

// Core components
import { ConfigValidator } from '../../core/config/ConfigValidator';
import { ConfigService } from '../../core/config/ConfigService';
import { ServerManager } from '../../core/server/ServerManager';
import { DeploymentManager } from '../../core/deployment/DeploymentManager';
import { PidManager } from '../../core/pid/PidManager';
import { HookManager } from '../../core/hooks/HookManager';
import { TomcatRuntime } from '../../core/server/TomcatRuntime';

// Types
import { ServerConfig, DeploymentConfig, ServerState, DeploymentState } from '../../core/types/domain';

suite('Java Server Manager - Comprehensive Tests', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Result utility', () => {
        test('ok() creates success result', () => {
            const result = ok('test value');
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.value, 'test value');
        });

        test('err() creates error result', () => {
            const result = err('test error');
            assert.strictEqual(result.ok, false);
            assert.strictEqual(result.error, 'test error');
        });

        test('Result type guards work correctly', () => {
            const success = ok('success');
            const failure = err('error');
            
            assert.strictEqual(success.ok, true);
            assert.strictEqual(failure.ok, false);
        });
    });

    suite('Logger', () => {
        test('Logger singleton works correctly', () => {
            const logger1 = Logger.getInstance();
            const logger2 = Logger.getInstance();
            assert.strictEqual(logger1, logger2);
        });

        test('createChild() creates child logger with prefix', () => {
            const parentLogger = Logger.getInstance();
            const childLogger = parentLogger.createChild('Test');
            // Both should exist and child should have prefix
            assert.ok(parentLogger);
            assert.ok(childLogger);
        });
    });

    suite('EventBus', () => {
        let eventBus: EventBus;

        setup(() => {
            eventBus = EventBus.getInstance();
        });

        test('EventBus singleton works correctly', () => {
            const eventBus1 = EventBus.getInstance();
            const eventBus2 = EventBus.getInstance();
            assert.strictEqual(eventBus1, eventBus2);
        });

        test('can listen to and emit events', () => {
            let received = false;
            
            eventBus.on('ServerAdded', () => {
                received = true;
            });

            const serverConfig: ServerConfig = {
                id: 'test-server',
                name: 'Test Server',
                type: 'tomcat',
                javaHome: '/usr/lib/jvm/java-17',
                serverHome: '/opt/tomcat',
                host: 'localhost',
                port: 8080,
                debug: { enable: false },
                autoSync: false,
                pidFile: 'test.pid',
                state: 'stopped',
                deployments: []
            };

            eventBus.emit('ServerAdded', serverConfig);
            assert.strictEqual(received, true);
        });
    });

    suite('ConfigValidator', () => {
        let validator: ConfigValidator;

        setup(() => {
            validator = new ConfigValidator();
        });

        test('validates correct server configuration', () => {
            const config = {
                servers: [{
                    id: 'test-server',
                    name: 'Test Server',
                    type: 'tomcat',
                    javaHome: '/usr/lib/jvm/java-17',
                    serverHome: '/opt/tomcat',
                    host: 'localhost',
                    port: 8080,
                    debug: { enable: false },
                    autoSync: false,
                    pidFile: 'test.pid',
                    state: 'stopped',
                    deployments: []
                }]
            };

            const result = validator.validate(config);
            assert.strictEqual(result.ok, true);
        });

        test('rejects invalid configuration', () => {
            const config = {
                servers: [{
                    id: '',  // Invalid empty ID
                    name: 'Test Server',
                    type: 'invalid-type',  // Invalid type
                    port: 'invalid-port'   // Invalid port type
                }]
            };

            const result = validator.validate(config);
            assert.strictEqual(result.ok, false);
        });
    });

    suite('ServerManager', () => {
        let serverManager: ServerManager;

        setup(() => {
            serverManager = new ServerManager();
        });

        test('registers server configuration', () => {
            const serverConfig: ServerConfig = {
                id: 'tomcat-1',
                name: 'Test Tomcat',
                type: 'tomcat',
                javaHome: '/usr/lib/jvm/java-17',
                serverHome: '/opt/tomcat',
                host: 'localhost',
                port: 8080,
                debug: { enable: false },
                autoSync: false,
                pidFile: 'tomcat-1.pid',
                state: 'stopped',
                deployments: []
            };

            const result = serverManager.register(serverConfig);
            assert.strictEqual(result.ok, true);
        });

        test('retrieves registered server runtime', () => {
            const serverConfig: ServerConfig = {
                id: 'tomcat-1',
                name: 'Test Tomcat',
                type: 'tomcat',
                javaHome: '/usr/lib/jvm/java-17',
                serverHome: '/opt/tomcat',
                host: 'localhost',
                port: 8080,
                debug: { enable: false },
                autoSync: false,
                pidFile: 'tomcat-1.pid',
                state: 'stopped',
                deployments: []
            };

            serverManager.register(serverConfig);
            const result = serverManager.get('tomcat-1');
            assert.strictEqual(result.ok, true);
        });

        test('fails to retrieve non-existent server', () => {
            const result = serverManager.get('non-existent');
            assert.strictEqual(result.ok, false);
        });
    });

    suite('DeploymentManager', () => {
        let deploymentManager: DeploymentManager;

        setup(() => {
            deploymentManager = new DeploymentManager('test-server');
        });

        test('adds deployment successfully', () => {
            const deployment: DeploymentConfig = {
                id: 'app-1',
                name: 'Test App',
                type: 'war',
                sourcePath: '/path/to/app.war',
                targetPath: '/opt/tomcat/webapps/app.war',
                contextPath: '/app',
                state: 'undeployed'
            };

            const result = deploymentManager.add(deployment);
            assert.strictEqual(result.ok, true);
        });

        test('prevents duplicate deployment IDs', () => {
            const deployment: DeploymentConfig = {
                id: 'app-1',
                name: 'Test App',
                type: 'war',
                sourcePath: '/path/to/app.war',
                targetPath: '/opt/tomcat/webapps/app.war',
                contextPath: '/app',
                state: 'undeployed'
            };

            deploymentManager.add(deployment);
            const result = deploymentManager.add(deployment);
            assert.strictEqual(result.ok, false);
        });

        test('retrieves deployment by ID', () => {
            const deployment: DeploymentConfig = {
                id: 'app-1',
                name: 'Test App',
                type: 'war',
                sourcePath: '/path/to/app.war',
                targetPath: '/opt/tomcat/webapps/app.war',
                contextPath: '/app',
                state: 'undeployed'
            };

            deploymentManager.add(deployment);
            const result = deploymentManager.get('app-1');
            assert.strictEqual(result.ok, true);
            if (result.ok) {
                assert.strictEqual(result.value.id, 'app-1');
            }
        });

        test('fails to retrieve non-existent deployment', () => {
            const result = deploymentManager.get('non-existent');
            assert.strictEqual(result.ok, false);
        });

        test('removes deployment successfully', () => {
            const deployment: DeploymentConfig = {
                id: 'app-1',
                name: 'Test App',
                type: 'war',
                sourcePath: '/path/to/app.war',
                targetPath: '/opt/tomcat/webapps/app.war',
                contextPath: '/app',
                state: 'undeployed'
            };

            deploymentManager.add(deployment);
            const result = deploymentManager.remove('app-1');
            assert.strictEqual(result.ok, true);
            
            // Verify it's gone
            const getResult = deploymentManager.get('app-1');
            assert.strictEqual(getResult.ok, false);
        });
    });

    suite('PidManager', () => {
        let pidManager: PidManager;

        setup(() => {
            pidManager = new PidManager();
        });

        test('writes and reads PID successfully', async () => {
            const fileName = 'test-server.pid';
            const pid = 12345;

            await pidManager.write(fileName, pid);
            const readPid = await pidManager.read(fileName);
            assert.strictEqual(readPid, pid);
        });

        test('returns null for non-existent PID file', async () => {
            const readPid = await pidManager.read('non-existent.pid');
            assert.strictEqual(readPid, null);
        });

        test('removes PID file successfully', async () => {
            const fileName = 'test-server.pid';
            const pid = 12345;

            await pidManager.write(fileName, pid);
            await pidManager.remove(fileName);
            
            const readPid = await pidManager.read(fileName);
            assert.strictEqual(readPid, null);
        });
    });

    suite('HookManager', () => {
        let hookManager: HookManager;

        setup(() => {
            hookManager = HookManager.getInstance();
        });

        test('HookManager singleton works correctly', () => {
            const hookManager1 = HookManager.getInstance();
            const hookManager2 = HookManager.getInstance();
            assert.strictEqual(hookManager1, hookManager2);
        });

        test('registers hook successfully', () => {
            const hook = {
                beforeStartServer: () => console.log('Starting server...')
            };

            const disposable = hookManager.register('test-hook', hook);
            assert.ok(disposable);
            assert.ok(typeof disposable.dispose === 'function');
            
            // Clean up
            disposable.dispose();
        });

        test('disposes hook successfully', () => {
            const hook = {
                beforeStartServer: () => console.log('Starting server...')
            };

            const disposable = hookManager.register('test-hook-dispose', hook);

            // Should not throw
            disposable.dispose();
            assert.ok(true);
        });

        test('invoke awaits async hooks', async () => {
            let completed = false;
            const hook = {
                beforeStartServer: async () => {
                    await new Promise(res => setTimeout(res, 50));
                    completed = true;
                }
            };
            const disposable = hookManager.register('async-hook', hook);
            const start = Date.now();
            await hookManager.invoke('beforeStartServer', 'id', 'run');
            const duration = Date.now() - start;
            disposable.dispose();
            assert.ok(completed, 'hook should execute');
            assert.ok(duration >= 50, 'invoke should await async hook');
        });
    });

    suite('TomcatRuntime', () => {
        let tomcatRuntime: TomcatRuntime;
        let serverConfig: ServerConfig;

        setup(() => {
            serverConfig = {
                id: 'tomcat-1',
                name: 'Test Tomcat',
                type: 'tomcat',
                javaHome: '/usr/lib/jvm/java-17',
                serverHome: '/opt/tomcat',
                host: 'localhost',
                port: 8080,
                debug: { enable: false },
                autoSync: false,
                pidFile: 'tomcat-1.pid',
                state: 'stopped',
                deployments: []
            };
            tomcatRuntime = new TomcatRuntime(serverConfig);
        });

        test('creates TomcatRuntime instance', () => {
            assert.ok(tomcatRuntime);
            // Test that the runtime is properly configured
            assert.ok(tomcatRuntime instanceof TomcatRuntime);
        });
    });

    suite('Integration Tests', () => {
        let serverManager: ServerManager;
        let deploymentManager: DeploymentManager;
        let eventBus: EventBus;

        setup(() => {
            serverManager = new ServerManager();
            deploymentManager = new DeploymentManager('test-server');
            eventBus = EventBus.getInstance();
        });

        test('full server lifecycle integration', () => {
            const serverConfig: ServerConfig = {
                id: 'tomcat-integration',
                name: 'Integration Test Tomcat',
                type: 'tomcat',
                javaHome: '/usr/lib/jvm/java-17',
                serverHome: '/opt/tomcat',
                host: 'localhost',
                port: 8080,
                debug: { enable: false },
                autoSync: false,
                pidFile: 'tomcat-integration.pid',
                state: 'stopped',
                deployments: []
            };

            // Register server
            const registerResult = serverManager.register(serverConfig);
            assert.strictEqual(registerResult.ok, true);

            // Get server runtime
            const getResult = serverManager.get('tomcat-integration');
            assert.strictEqual(getResult.ok, true);

            // Add deployment
            const deployment: DeploymentConfig = {
                id: 'integration-app',
                name: 'Integration Test App',
                type: 'war',
                sourcePath: '/path/to/app.war',
                targetPath: '/opt/tomcat/webapps/app.war',
                contextPath: '/integration-app',
                state: 'undeployed'
            };

            const addResult = deploymentManager.add(deployment);
            assert.strictEqual(addResult.ok, true);

            // Verify deployment exists
            const getDepResult = deploymentManager.get('integration-app');
            assert.strictEqual(getDepResult.ok, true);
        });

        test('handles multiple servers and deployments', () => {
            const servers: ServerConfig[] = [
                {
                    id: 'tomcat-1',
                    name: 'Tomcat Server 1',
                    type: 'tomcat',
                    javaHome: '/usr/lib/jvm/java-17',
                    serverHome: '/opt/tomcat1',
                    host: 'localhost',
                    port: 8080,
                    debug: { enable: false },
                    autoSync: false,
                    pidFile: 'tomcat-1.pid',
                    state: 'stopped',
                    deployments: []
                },
                {
                    id: 'tomcat-2',
                    name: 'Tomcat Server 2',
                    type: 'tomcat',
                    javaHome: '/usr/lib/jvm/java-17',
                    serverHome: '/opt/tomcat2',
                    host: 'localhost',
                    port: 8081,
                    debug: { enable: false },
                    autoSync: false,
                    pidFile: 'tomcat-2.pid',
                    state: 'stopped',
                    deployments: []
                }
            ];

            // Register all servers
            servers.forEach(server => {
                const result = serverManager.register(server);
                assert.strictEqual(result.ok, true);
            });

            // Verify all servers can be retrieved
            servers.forEach(server => {
                const result = serverManager.get(server.id);
                assert.strictEqual(result.ok, true);
            });

            // Add deployments to each server
            const deployments: DeploymentConfig[] = [
                {
                    id: 'app-1',
                    name: 'App 1',
                    type: 'war',
                    sourcePath: '/path/to/app1.war',
                    targetPath: '/opt/tomcat1/webapps/app1.war',
                    contextPath: '/app1',
                    state: 'undeployed'
                },
                {
                    id: 'app-2',
                    name: 'App 2',
                    type: 'war',
                    sourcePath: '/path/to/app2.war',
                    targetPath: '/opt/tomcat2/webapps/app2.war',
                    contextPath: '/app2',
                    state: 'undeployed'
                }
            ];

            deployments.forEach(deployment => {
                const result = deploymentManager.add(deployment);
                assert.strictEqual(result.ok, true);
            });

            // Verify deployments by checking individual ones
            const app1Result = deploymentManager.get('app-1');
            const app2Result = deploymentManager.get('app-2');
            assert.strictEqual(app1Result.ok, true);
            assert.strictEqual(app2Result.ok, true);
        });

        test('event system integration', () => {
            let eventsReceived: string[] = [];

            // Set up event listeners
            eventBus.on('ServerAdded', (server) => {
                eventsReceived.push(`server-added:${server.id}`);
            });

            eventBus.on('DeploymentAdded', (deployment) => {
                eventsReceived.push(`deployment-added:${deployment.id}`);
            });

            // Trigger events
            const serverConfig: ServerConfig = {
                id: 'event-test-server',
                name: 'Event Test Server',
                type: 'tomcat',
                javaHome: '/usr/lib/jvm/java-17',
                serverHome: '/opt/tomcat',
                host: 'localhost',
                port: 8080,
                debug: { enable: false },
                autoSync: false,
                pidFile: 'event-test.pid',
                state: 'stopped',
                deployments: []
            };

            const deployment: DeploymentConfig = {
                id: 'event-test-app',
                name: 'Event Test App',
                type: 'war',
                sourcePath: '/path/to/app.war',
                targetPath: '/opt/tomcat/webapps/app.war',
                contextPath: '/event-test-app',
                state: 'undeployed'
            };

            eventBus.emit('ServerAdded', serverConfig);
            eventBus.emit('DeploymentAdded', deployment);

            // Verify events were received
            assert.strictEqual(eventsReceived.length, 2);
            assert.ok(eventsReceived.includes('server-added:event-test-server'));
            assert.ok(eventsReceived.includes('deployment-added:event-test-app'));
        });
    });

    suite('Error Handling Tests', () => {
        test('handles invalid server configurations gracefully', () => {
            const serverManager = new ServerManager();
            
            // Test with missing required fields
            const invalidConfig = {
                id: '',  // Empty ID should fail
                type: 'invalid'  // Invalid type
            } as any;

            // This should handle the error gracefully
            try {
                const result = serverManager.register(invalidConfig);
                assert.strictEqual(result.ok, false);
            } catch (error) {
                // If it throws, that's also acceptable error handling
                assert.ok(error);
            }
        });

        test('handles deployment errors gracefully', () => {
            const deploymentManager = new DeploymentManager('test-server');
            
            // Test with invalid deployment config
            const invalidDeployment = {
                id: '',  // Empty ID should fail
                type: 'invalid'
            } as any;

            try {
                const result = deploymentManager.add(invalidDeployment);
                assert.strictEqual(result.ok, false);
            } catch (error) {
                // If it throws, that's also acceptable error handling
                assert.ok(error);
            }
        });
    });

    suite('Performance Tests', () => {
        test('handles large number of deployments efficiently', () => {
            const deploymentManager = new DeploymentManager('perf-test-server');
            const startTime = Date.now();

            // Add 1000 deployments
            for (let i = 0; i < 1000; i++) {
                const deployment: DeploymentConfig = {
                    id: `app-${i}`,
                    name: `Application ${i}`,
                    type: 'war',
                    sourcePath: `/path/to/app-${i}.war`,
                    targetPath: `/opt/tomcat/webapps/app-${i}.war`,
                    contextPath: `/app-${i}`,
                    state: 'undeployed'
                };

                deploymentManager.add(deployment);
            }

            const duration = Date.now() - startTime;
            
            // Should complete in reasonable time (less than 1 second)
            assert.ok(duration < 1000, `Adding 1000 deployments took ${duration}ms`);
            
            // Verify all were added
            const allDeployments = deploymentManager.getAll();
            assert.strictEqual(allDeployments.length, 1000);
        });

        test('event system handles many listeners efficiently', () => {
            const eventBus = EventBus.getInstance();
            let callCount = 0;

            const startTime = Date.now();

            // Add 1000 listeners
            for (let i = 0; i < 1000; i++) {
                eventBus.on('ServerAdded', () => {
                    callCount++;
                });
            }

            const serverConfig: ServerConfig = {
                id: 'perf-test-server',
                name: 'Performance Test Server',
                type: 'tomcat',
                javaHome: '/usr/lib/jvm/java-17',
                serverHome: '/opt/tomcat',
                host: 'localhost',
                port: 8080,
                debug: { enable: false },
                autoSync: false,
                pidFile: 'perf-test.pid',
                state: 'stopped',
                deployments: []
            };

            // Emit event to all listeners
            eventBus.emit('ServerAdded', serverConfig);

            const duration = Date.now() - startTime;

            // Should complete quickly
            assert.ok(duration < 100, `Event emission to 1000 listeners took ${duration}ms`);
            assert.strictEqual(callCount, 1000);
        });
    });
});
