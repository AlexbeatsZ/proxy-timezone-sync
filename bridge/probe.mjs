import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';

function connectTunnel(port) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, method: 'CONNECT', path: 'ipwho.is:443', agent: false, timeout: 6000 });
        req.on('connect', (response, socket, head) => {
            if (response.statusCode !== 200 || head.length) {
                socket.destroy(); reject(new Error('Proxy tunnel failed')); return;
            }
            socket.setTimeout(10000, () => socket.destroy());
            socket.on('error', () => {});
            resolve(socket);
        });
        req.on('timeout', () => req.destroy(new Error('Proxy timeout')));
        req.on('error', reject);
        req.end();
    });
}

export async function openProbe(port) {
    const socket = await connectTunnel(port);
    const sourcePort = socket.localPort;
    const tlsSocket = tls.connect({ socket, servername: 'ipwho.is', ALPNProtocols: ['http/1.1'] });
    try {
        await new Promise((resolve, reject) => {
            tlsSocket.once('secureConnect', resolve);
            tlsSocket.once('error', reject);
            tlsSocket.once('close', () => reject(new Error('Proxy TLS connection closed')));
        });
    } catch (error) { tlsSocket.destroy(); socket.destroy(); throw error; }
    let agent;
    return {
        sourcePort,
        close() { agent?.destroy(); tlsSocket?.destroy(); socket.destroy(); },
        lookup() {
            return new Promise((resolve, reject) => {
                tlsSocket.once('error', reject);
                tlsSocket.once('close', () => reject(new Error('IP probe closed')));
                agent = new https.Agent({ keepAlive: false });
                agent.createConnection = () => tlsSocket;
                const request = https.get({ hostname: 'ipwho.is', path: '/?fields=success,ip,timezone.id', agent, timeout: 8000, headers: { 'User-Agent': 'ProxyTimezoneSync/3.0', 'Accept': 'application/json' } }, response => {
                    let body = '';
                    response.on('data', chunk => {
                        body += chunk;
                        if (body.length > 16384) request.destroy(new Error('IP response too large'));
                    });
                    response.on('error', reject);
                    response.on('end', () => {
                        try {
                            if (response.statusCode !== 200) throw new Error('IP lookup failed');
                            const data = JSON.parse(body);
                            if (data.success === false || !net.isIP(data.ip) || !data.timezone?.id) throw new Error('Invalid IP lookup response');
                            new Intl.DateTimeFormat('en', { timeZone: data.timezone.id });
                            resolve({ ip: data.ip, timeZone: data.timezone.id });
                        } catch (error) { reject(error); }
                    });
                });
                request.on('timeout', () => request.destroy(new Error('IP lookup timeout')));
                request.on('error', reject);
            });
        }
    };
}
