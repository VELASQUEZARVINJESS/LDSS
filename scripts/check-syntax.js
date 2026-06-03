const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT_DIR = path.resolve(__dirname, "..");
const JS_ROOT = path.join(ROOT_DIR, "js");
const TARGETS = [path.join(ROOT_DIR, "server.js")];

function collectJsFiles(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        return [];
    }

    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    const files = [];

    entries.forEach(function (entry) {
        const fullPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push.apply(files, collectJsFiles(fullPath));
            return;
        }
        if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".js") {
            files.push(fullPath);
        }
    });

    return files;
}

TARGETS.push.apply(TARGETS, collectJsFiles(JS_ROOT).sort());

let hasErrors = false;

TARGETS.forEach(function (targetPath) {
    const source = fs.readFileSync(targetPath, "utf8");
    try {
        new vm.Script(source, { filename: targetPath });
    } catch (error) {
        hasErrors = true;
        const relativePath = path.relative(ROOT_DIR, targetPath) || path.basename(targetPath);
        console.error("Syntax error in " + relativePath);
        console.error(error && error.stack ? error.stack : String(error));
    }
});

if (hasErrors) {
    process.exit(1);
}

console.log("Syntax OK: checked " + TARGETS.length + " JavaScript files.");
