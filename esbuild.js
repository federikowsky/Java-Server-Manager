const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/** Extension host bundle (Node / CJS) */
const extensionConfig = {
	entryPoints: ['src/extension.ts'],
	bundle: true,
	format: 'cjs',
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	platform: 'node',
	outfile: 'dist/extension.js',
	external: ['vscode', 'fsevents'],
	logLevel: 'silent',
	plugins: [esbuildProblemMatcherPlugin],
};

/** Webview client bundle (browser / IIFE) */
const webviewConfig = {
	entryPoints: ['src/ui/webviews/client/index.ts'],
	bundle: true,
	format: 'iife',
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	platform: 'browser',
	outfile: 'dist/webview/webview.js',
	logLevel: 'silent',
	plugins: [esbuildProblemMatcherPlugin],
};

async function main() {
	// Build webview client only when entry exists (Phase 7+)
	const fs = require('fs');
	const path = require('path');
	const buildWebview = fs.existsSync('src/ui/webviews/client/index.ts');

	const configs = [extensionConfig];
	if (buildWebview) configs.push(webviewConfig);

	if (watch) {
		for (const config of configs) {
			const ctx = await esbuild.context(config);
			await ctx.watch();
		}
	} else {
		for (const config of configs) {
			const ctx = await esbuild.context(config);
			await ctx.rebuild();
			await ctx.dispose();
		}
	}

	// Copy webview CSS to dist/webview/
	if (buildWebview) {
		const cssSrc = path.join('src', 'ui', 'webviews', 'client', 'styles', 'base.css');
		const cssDest = path.join('dist', 'webview', 'webview.css');
		if (fs.existsSync(cssSrc)) {
			fs.mkdirSync(path.dirname(cssDest), { recursive: true });
			fs.copyFileSync(cssSrc, cssDest);
		}
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
