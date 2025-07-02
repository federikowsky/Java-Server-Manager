# Java Server Manager (JSM)

A modern, production-ready alternative to Red Hat Server Connector for managing Java application servers directly within VS Code. Built with TypeScript and designed for enterprise development workflows.

## ✨ Features

### 🚀 **Server Management**
- **Multi-Server Support**: Apache Tomcat (with Jetty, JBoss planned)
- **Lifecycle Control**: Start, stop, restart servers with run/debug modes
- **State Persistence**: Automatic crash recovery and state synchronization
- **Configuration Templates**: Pre-built templates for common server configurations

### 🎯 **Development Experience**
- **Debug Integration**: Seamless JPDA debug support with automatic VSCode attachment
- **Auto-Sync Deployments**: Real-time file synchronization for rapid development
- **Tree View Interface**: Intuitive server and deployment management in sidebar
- **Context Menus**: Dynamic context menus based on server state

### 📦 **Deployment Management**
- **WAR & Exploded Deployments**: Support for both WAR files and exploded directories
- **Incremental Updates**: Smart deployment that only updates changed files
- **Hot Deployment**: Deploy without server restart
- **Deployment States**: Track deployment status and errors

### ⚙️ **Enterprise Features**
- **JVM Optimization**: Production-ready JVM configurations
- **Environment Variables**: Comprehensive environment and system property management
- **Health Monitoring**: Server health checks and status monitoring
- **Logging Integration**: Built-in log viewing and output channels

## 🛠️ Requirements

- **VS Code**: Version 1.100.0 or higher
- **Java**: JDK 8 or higher installed and accessible
- **Application Server**: Supported server installation (e.g., Apache Tomcat)

### Recommended Setup
- **Java Extension Pack**: For enhanced Java development experience
- **Debugger for Java**: For debugging support (usually included in Java Extension Pack)

## 📋 Quick Start

### 1. Install Extension
Install from VS Code Marketplace or build from source:
```bash
git clone https://github.com/yourusername/java-server-manager
cd java-server-manager
npm install
npm run compile
```

### 2. Configure Server
Open the Java Server Manager view in the sidebar and:
1. Click "Add Server from Template" or "Create New Server"
2. Configure server paths and settings
3. Add deployments as needed

### 3. Start Development
- Right-click server → "Start (Debug)" for debug mode
- Right-click deployment → "Force Deploy" to deploy applications
- Enable "Auto Sync" for real-time file synchronization

## 🔧 Configuration

### Server Configuration Example
```json
{
  "id": "tomcat-dev",
  "name": "Development Tomcat",
  "type": "tomcat",
  "javaHome": "/usr/lib/jvm/java-17",
  "serverHome": "/opt/tomcat",
  "host": "localhost",
  "port": 8080,
  "debug": {
    "enable": true,
    "port": 5005,
    "vmArgs": "-Xdebug -agentlib:jdwp=transport=dt_socket,server=y,suspend=n"
  },
  "autoSync": true,
  "envVars": {
    "CATALINA_OPTS": "-server -XX:+UseG1GC",
    "JAVA_OPTS": "-Xmx1g -Xms256m"
  },
  "deployments": [...]
}
```

### Deployment Configuration Example
```json
{
  "id": "webapp-1",
  "name": "My Web Application",
  "sourcePath": "./target/webapp.war",
  "targetPath": "webapps/webapp.war",
  "contextPath": "/webapp",
  "type": "war",
  "state": "undeployed"
}
```

## 🎮 Commands

### Server Commands
- `JSM: Add Server from Template` - Create server from pre-built template
- `JSM: Create New Server` - Create server with custom configuration
- `JSM: Start Server (Run)` - Start server in normal mode
- `JSM: Start Server (Debug)` - Start server with debug support
- `JSM: Stop Server` - Stop running server
- `JSM: Restart Server` - Restart server (run/debug modes)
- `JSM: Edit Server` - Modify server configuration
- `JSM: Delete Server` - Remove server configuration

### Deployment Commands
- `JSM: Add Deployment` - Add new deployment to server
- `JSM: Force Deploy` - Deploy application to server
- `JSM: Undeploy (Soft)` - Mark as undeployed, keep files
- `JSM: Undeploy (Hard)` - Remove deployment completely
- `JSM: Toggle AutoSync` - Enable/disable automatic synchronization

### Template Commands
- `JSM: View All Templates` - Manage global server templates
- `JSM: Add Global Template` - Create new server template
- `JSM: Edit Global Template` - Modify existing template
- `JSM: Delete Global Template` - Remove template

## 🎯 Advanced Features

### Debug Support
- **Automatic Port Assignment**: Finds available debug ports automatically
- **VSCode Integration**: Creates and attaches debug configurations automatically
- **JPDA Configuration**: Full Java Platform Debugger Architecture support
- **Custom Debug Args**: Support for custom JDWP arguments

### Auto-Sync
- **File Watching**: Monitors source directories for changes
- **Incremental Updates**: Only deploys changed files
- **Configurable Filters**: Exclude patterns (node_modules, .tmp files, etc.)
- **Debounced Updates**: Prevents excessive deployment triggering

### JVM Optimization
- **Memory Management**: Automatic heap size configuration
- **Garbage Collection**: Optimized GC settings (G1GC, string deduplication)
- **Performance Tuning**: JVM flags for development and production
- **Monitoring**: JMX enablement for server monitoring

### Environment Management
- **System Properties**: Comprehensive Java system property support
- **Environment Variables**: Custom environment variable injection
- **Path Management**: Automatic CATALINA_HOME, JAVA_HOME configuration
- **Platform Support**: Cross-platform Windows, macOS, Linux support

## 🔍 Troubleshooting

### Common Issues

**Server won't start**
- Verify JAVA_HOME and server installation paths
- Check port availability (8080, debug port)
- Review server logs in output channel

**Deployment fails**
- Ensure source files exist and are accessible
- Check server webapps directory permissions
- Verify deployment configuration paths

**Debug connection fails**
- Confirm debug port is available
- Check firewall settings
- Verify JPDA configuration in server settings

**Auto-sync not working**
- Check file watcher permissions
- Verify source path configuration
- Review ignore patterns for conflicts

### Log Files
- **Extension Logs**: Available in "Java Server Manager" output channel
- **Server Logs**: Access via "View Logs" command or server console
- **Debug Logs**: Enable via extension settings for verbose output

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
```bash
git clone https://github.com/yourusername/java-server-manager
cd java-server-manager
npm install
npm run watch
```

Press `F5` to launch extension development host.

### Project Structure
```
src/
├── commands/           # VSCode command implementations
├── core/              # Core business logic
│   ├── config/        # Configuration management
│   ├── server/        # Server runtime implementations
│   ├── deployment/    # Deployment management
│   └── types/         # TypeScript type definitions
├── services/          # High-level service orchestration
├── ui/               # User interface components
└── extension.ts      # Extension entry point
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by Red Hat Server Connector and other Java tooling
- Built with VS Code Extension API and modern TypeScript
- Thanks to the VS Code and Java communities for inspiration and feedback

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
