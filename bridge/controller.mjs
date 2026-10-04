import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const READ_PATHS = new Set(['/version', '/configs', '/connections', '/proxies', '/providers/proxies']);

export function controllerCandidates(config = {}) {
    if (config.socketPath) return [config.socketPath];
    if (process.platform === 'win32') {
        return fs.readdirSync('\\\\.\\pipe\\')
            .filter(name => name.startsWith('verge-mihomo-production-'))
            .map(name => '\\\\.\\pipe\\' + name);
    }
    const uid = process.getuid?.();
    const candidates = [
        `/var/run/clash-verge-service/users/${uid}/verge-mihomo.sock`,
        `/var/run/clash-verge-rev/users/${uid}/verge-mihomo.sock`,
        '/tmp/verge/verge-mihomo.sock'
    ];
    const appConfig = path.join(os.homedir(), 'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml');
    if (fs.existsSync(appConfig)) {
        const match = fs.readFileSync(appConfig, 'utf8').match(/^external-controller-unix:\s*['"]?([^\r\n'"]+)['"]?\s*$/m);
        if (match) candidates.push(match[1].trim());
    }
    return [...new Set(candidates)].filter(candidate => fs.existsSync(candidate));
}

export function ipcJson(socketPath, requestPath) {
    if (!READ_PATHS.has(requestPath)) throw new Error('Controller operation is not allowed');
    return new Promise((resolve, reject) => {
        const req = http.get({ socketPath, path: requestPath, timeout: 3000 }, response => {
            let body = '';
            response.on('data', chunk => {
                body += chunk;
                if (body.length > 8 * 1024 * 1024) req.destroy(new Error('Controller response too large'));
            });
            response.on('error', reject);
            response.on('end', () => {
                try {
                    if (response.statusCode !== 200) throw new Error('Controller unavailable');
                    resolve(JSON.parse(body));
                } catch (error) { reject(error); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('Controller timeout')));
        req.on('error', reject);
    });
}

export function createController(config = {}) {
    let selected;
    return async requestPath => {
        if (selected) {
            try { return await ipcJson(selected, requestPath); }
            catch { selected = undefined; }
        }
        for (const candidate of controllerCandidates(config)) {
            try {
                const response = await ipcJson(candidate, requestPath);
                selected = candidate;
                return response;
            } catch { /* Try another actual local IPC endpoint. */ }
        }
        throw new Error('No running Mihomo controller was found');
    };
}
