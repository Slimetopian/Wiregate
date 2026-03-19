const { recordInstalledVersion } = require('../lib/app-meta');

const source = process.argv[2] || 'install';
const entry = recordInstalledVersion(source);

process.stdout.write(`${entry.version}\n`);