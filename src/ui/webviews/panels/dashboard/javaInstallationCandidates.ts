import * as fs from 'fs/promises';
import * as path from 'path';

export interface JavaInstallationCandidate {
  label: string;
  description: string;
  path: string;
}

/**
 * Scan common locations and JAVA_HOME for JDK roots that contain bin/java.
 */
export async function collectJavaInstallationCandidates(): Promise<JavaInstallationCandidate[]> {
  const candidates: JavaInstallationCandidate[] = [];

  const envJavaHome = process.env.JAVA_HOME;
  if (envJavaHome?.trim()) {
    const javaExe = process.platform === 'win32' ? 'java.exe' : 'java';
    const javaPath = path.join(envJavaHome.trim(), 'bin', javaExe);
    try {
      await fs.access(javaPath);
      candidates.push({
        label: `$(environment) JAVA_HOME`,
        description: envJavaHome.trim(),
        path: envJavaHome.trim(),
      });
    } catch {
      /* JAVA_HOME set but invalid */
    }
  }

  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const commonPaths: string[] = [];
  if (isMac) {
    commonPaths.push(
      '/Library/Java/JavaVirtualMachines',
      '/opt/homebrew/opt',
      '/usr/local/opt',
    );
  } else if (isWindows) {
    commonPaths.push(
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft',
    );
  } else {
    commonPaths.push(
      '/usr/lib/jvm',
      '/usr/java',
      '/opt/java',
      '/snap/java',
    );
  }

  for (const basePath of commonPaths) {
    try {
      const entries = await fs.readdir(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        let javaHome: string;
        if (isMac && basePath.includes('JavaVirtualMachines')) {
          javaHome = path.join(basePath, entry.name, 'Contents', 'Home');
        } else if (basePath.includes('opt') || basePath.includes('local')) {
          javaHome = path.join(basePath, entry.name, 'libexec', 'openjdk.jdk', 'Contents', 'Home');
        } else {
          javaHome = path.join(basePath, entry.name);
        }
        const javaExe = isWindows ? 'java.exe' : 'java';
        const javaBinPath = path.join(javaHome, 'bin', javaExe);
        try {
          await fs.access(javaBinPath);
          if (!candidates.some(c => c.path === javaHome)) {
            candidates.push({
              label: `$(folder) ${entry.name}`,
              description: javaHome,
              path: javaHome,
            });
          }
        } catch {
          /* no java executable */
        }
      }
    } catch {
      /* directory missing or unreadable */
    }
  }

  return candidates;
}
