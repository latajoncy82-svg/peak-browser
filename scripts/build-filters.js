const path = require('path');
const { buildAndSaveEngine } = require('../src/shield');

async function main() {
  const assetsDir = path.resolve(__dirname, '..', 'assets');
  console.log('Downloading & compiling adblock filter lists into:', assetsDir);
  const info = await buildAndSaveEngine(assetsDir, { activate: false });
  console.log('Shield engine compiled successfully:');
  console.log('  Rules:', info.ruleCount);
  console.log('  Binary size:', info.sizeBytes, 'bytes');
  console.log('  Lists:', info.lists.join(', '));
  console.log('  Updated:', info.updatedAt);
}

main().catch((err) => {
  console.error('Failed to build filter engine:', err);
  process.exit(1);
});
