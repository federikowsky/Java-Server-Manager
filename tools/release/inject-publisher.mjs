import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.join(process.cwd(), 'package.json');
const publisher = process.env.JSM_MARKETPLACE_PUBLISHER?.trim();

if (!publisher) {
  console.error('JSM_MARKETPLACE_PUBLISHER is required to inject Marketplace identity.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.publisher && manifest.publisher !== publisher) {
  console.error(
    `Manifest publisher "${manifest.publisher}" does not match JSM_MARKETPLACE_PUBLISHER "${publisher}".`,
  );
  process.exit(1);
}

manifest.publisher = publisher;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Injected publisher "${publisher}" into package.json for CI packaging.`);
