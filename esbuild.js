const esbuild = require("esbuild");
const sveltePlugin = require("esbuild-svelte");

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
	entryPoints: ['src/ui/webviews/client/main.ts'],
	bundle: true,
	format: 'iife',
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	platform: 'browser',
	outfile: 'dist/webview/webview.js',
	mainFields: ['svelte', 'browser', 'module', 'main'],
	conditions: ['svelte', 'browser'],
	logLevel: 'silent',
	plugins: [
		sveltePlugin({
			compilerOptions: {
				css: 'external',
				runes: true,
				dev: !production,
			},
		}),
		esbuildProblemMatcherPlugin,
	],
};

async function main() {
	// Build webview client only when entry exists (Phase 7+)
	const fs = require('fs');
	const path = require('path');
	const buildWebview = fs.existsSync('src/ui/webviews/client/main.ts');

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

	// Copy webview global CSS to dist/webview/
	if (buildWebview) {
		const cssSrc = path.join('src', 'ui', 'webviews', 'client', 'styles', 'global.css');
		const cssDest = path.join('dist', 'webview', 'webview.css');
		if (fs.existsSync(cssSrc)) {
			fs.mkdirSync(path.dirname(cssDest), { recursive: true });
			// If the Svelte plugin already emitted a CSS file, prepend global.css
			const globalCss = fs.readFileSync(cssSrc, 'utf8');
			if (fs.existsSync(cssDest)) {
				const svelteCss = fs.readFileSync(cssDest, 'utf8');
				fs.writeFileSync(cssDest, globalCss + '\n' + svelteCss, 'utf8');
			} else {
				fs.writeFileSync(cssDest, globalCss, 'utf8');
			}
		}
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
