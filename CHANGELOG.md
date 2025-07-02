# Changelog

All notable changes to the Java Server Manager extension will be documented in this file.

## [Unreleased]

### Added - TomcatRuntime Production Implementation
- **Complete TomcatRuntime Implementation**: Production-ready Apache Tomcat support
  - Full `buildLaunchCommand` implementation with platform detection
  - Comprehensive JVM optimization (G1GC, memory management, performance tuning)
  - Advanced debug support with JPDA configuration
  - Environment variable management (CATALINA_HOME, JAVA_HOME, custom vars)
  
- **Deployment Management**: Enterprise-grade deployment capabilities
  - WAR file deployment with timestamp checking
  - Exploded directory deployment with incremental updates
  - Smart incremental copy (only changed files)
  - Work directory cleanup during undeploy
  - Soft vs hard undeploy options
  
- **Configuration Validation**: Robust server configuration validation
  - JAVA_HOME and CATALINA_HOME validation
  - Required Tomcat directory structure checks (bin, conf, lib, webapps)
  - Catalina script existence and permission validation
  - Comprehensive error reporting
  
- **JVM Optimization**: Production-ready JVM configuration
  - Default memory settings (Xmx512m, Xms128m)
  - G1 Garbage Collector with string deduplication
  - Security settings (headless mode, entropy sources)
  - JMX monitoring configuration
  - Custom VM arguments support
  
- **Debug Support**: Advanced debugging capabilities
  - Automatic JPDA configuration
  - Custom debug port assignment
  - JPDA_OPTS support for custom debug arguments
  - VSCode integration for seamless debugging
  
- **Documentation**: Comprehensive documentation
  - Complete Tomcat runtime implementation guide
  - Server configuration examples (dev, prod, debug)
  - Deployment configuration examples
  - Global template examples
  - Troubleshooting guide

### Enhanced - Server Configuration
- **Enhanced ServerConfig**: Updated example configurations
  - Development server with debug enabled
  - Production server with optimized JVM settings
  - Multiple deployment examples (WAR and exploded)
  - Environment variable examples
  
- **Template System**: Improved template support
  - Development template with debug and auto-sync
  - Production template with performance optimization
  - Microservice template with minimal footprint
  - Template usage guidelines

### Technical Improvements
- **Error Handling**: Comprehensive error handling with specific error codes
- **Logging**: Detailed logging for debugging and monitoring
- **Platform Support**: Cross-platform Windows, macOS, Linux support
- **Type Safety**: Full TypeScript type safety with proper interfaces
- **Performance**: Optimized for enterprise-scale server management

### Fixed
- **TomcatRuntime Issues**: Resolved all implementation gaps
  - Fixed missing `buildLaunchCommand` method
  - Removed orphaned `buildStartCommand` method
  - Implemented proper deploy/undeploy functionality
  - Added missing parameter validation

### Documentation
- **README.md**: Complete rewrite with features, setup, and usage
- **tomcat-runtime.md**: Detailed technical documentation
- **server-configuration-examples.md**: Practical configuration examples
- **global-templates-example.md**: Template system documentation

---

## [0.0.1] - Initial Release

### Added
- Basic extension structure and VS Code integration
- Command system for server and deployment management
- Tree view for server visualization
- Basic server lifecycle management
- Event bus and error handling system
- Configuration service and validation
- Basic Tomcat runtime (stub implementation)

### Features
- Server CRUD operations
- Deployment management
- Auto-sync service
- Debug manager integration
- Global template system
- Extension activation and lifecycle management