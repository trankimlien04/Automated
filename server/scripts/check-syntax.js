const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const serverRoot = path.resolve(__dirname, '..');
const jsFiles = [];

function collectJsFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectJsFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            jsFiles.push(fullPath);
        }
    }
}

collectJsFiles(serverRoot);
jsFiles.sort();

let failedCount = 0;
for (const file of jsFiles) {
    try {
        execFileSync(process.execPath, ['-c', file], { stdio: 'pipe' });
    } catch (err) {
        failedCount++;
        console.error(`[SYNTAX ERROR] ${path.relative(serverRoot, file)}`);
        if (err.stderr) console.error(err.stderr.toString());
    }
}

if (failedCount > 0) {
    console.error(`Backend syntax check failed: ${failedCount}/${jsFiles.length} file(s) invalid.`);
    process.exit(1);
}

console.log(`Backend syntax check passed: ${jsFiles.length} file(s) verified.`);

