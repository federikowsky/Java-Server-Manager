/**
 * Webview client entry point — Svelte 5.
 *
 * Mounts App.svelte into #root.
 * Compiled by esbuild + esbuild-svelte as IIFE → dist/webview/webview.js.
 */

import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('root');
if (target) {
  mount(App, { target });
}
