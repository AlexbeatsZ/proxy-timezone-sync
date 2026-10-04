import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createController } from './controller.mjs';
import { aiHostsFromSource, allowedHost, createResolver } from './routes.mjs';
import { openProbe } from './probe.mjs';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(projectRoot, '.runtime');
const configPath = path.join(runtime, 'bridge-config.json');

export function initialize(clientFile) {
    fs.mkdirSync(runtime, { recursive: true });
    if (!fs.existsSync(configPath)) {
        const shared = clientFile ? JSON.parse(fs.readFileSync(clientFile, 'utf8')).token : undefined;
        if (shared !== undefined && !/^[a-f0-9]{64}$/.test(shared)) throw new Error('Invalid shared token file');
        const config = { token: shared || crypto.randomBytes(32).toString('hex'), instanceId: crypto.randomUUID(), port: 17898, probePorts: [7897, 17897] };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    fs.writeFileSync(path.join(runtime, 'client-settings.json'), JSON.stringify({ url: 'http://127.0.0.1:17898', token: config.token }, null, 2) + '\n', { mode: 0o600 });
    return config;
}

function authenticated(header, token) {
    const supplied = Buffer.from(header || '');
    const expected = Buffer.from('Bearer ' + token);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

export function createBridgeServer({ config, domains, resolve }) {
    return http.createServer(async (request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
        if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) ||
            request.headers.host !== '127.0.0.1:' + config.port) return send(403, { error: 'Local access only' });
        if (request.method !== 'GET') return send(405, { error: 'Read-only endpoint' });
        if (!authenticated(request.headers.authorization, config.token)) return send(401, { error: 'Authentication required' });
        const url = new URL(request.url, 'http://127.0.0.1:' + config.port);
        if (url.pathname === '/v1/health') return send(200, { ready: true, version: '3.0.0' });
        if (url.pathname !== '/v1/timezone') return send(404, { error: 'Unknown endpoint' });
        const host = url.searchParams.get('host');
        if (!allowedHost(host, domains)) return send(400, { error: 'Website is outside the AI allowlist' });
        try {
            const result = await resolve(host, url.searchParams.get('fresh') === '1');
            send(200, result);
        } catch {
            // Do not expose controller paths, credentials, unrelated connections or raw errors.
            send(409, { error: 'Could not verify this website outbound' });
        }
    });
}

export async function main(args = process.argv.slice(2)) {
    if (args.includes('--init')) {
        const tokenFileIndex = args.indexOf('--client-settings');
        initialize(tokenFileIndex >= 0 ? args[tokenFileIndex + 1] : undefined);
        console.log('Client settings: ' + path.join(runtime, 'client-settings.json'));
        return;
    }
    if (!fs.existsSync(configPath)) throw new Error('Initialize the bridge first with --init');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.port !== 17898 || !/^[a-f0-9]{64}$/.test(config.token) ||
        !Array.isArray(config.probePorts) || !config.probePorts.length ||
        config.probePorts.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Invalid bridge configuration');
    const source = fs.readFileSync(path.join(projectRoot, 'proxy-timezone-sync.user.js'), 'utf8');
    const controller = createController(config);
    await controller('/version');
    const resolve = createResolver({ controller, openProbe, probePorts: config.probePorts, instanceId: config.instanceId });
    const server = createBridgeServer({ config, domains: aiHostsFromSource(source), resolve });
    server.requestTimeout = 25000;
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    server.listen(config.port, '127.0.0.1', () => console.log('Proxy timezone bridge listening on 127.0.0.1:' + config.port));
    const close = () => server.close(() => process.exit());
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
