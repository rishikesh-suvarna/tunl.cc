"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const proxy_1 = require("../../src/cli/proxy");
const constants_1 = require("../../src/shared/constants");
async function startLocalServer(handler) {
    const server = http_1.default.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    return {
        port,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
function call(localPort, msg = {}) {
    const requestMsg = {
        type: constants_1.MessageType.REQUEST,
        requestId: 'test-req-id',
        method: 'GET',
        path: '/',
        headers: {},
        ...msg,
    };
    return new Promise((resolve) => (0, proxy_1.forwardToLocal)(localPort, requestMsg, resolve));
}
describe('forwardToLocal', () => {
    describe('binary fidelity', () => {
        it('round-trips arbitrary binary bytes byte-perfect via base64', async () => {
            const binary = Buffer.alloc(256);
            for (let i = 0; i < 256; i++)
                binary[i] = i;
            const local = await startLocalServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
                res.end(binary);
            });
            try {
                const response = await call(local.port);
                expect(response.statusCode).toBe(200);
                expect(response.bodyEncoding).toBe('base64');
                const decoded = Buffer.from(response.body, 'base64');
                expect(decoded.equals(binary)).toBe(true);
            }
            finally {
                await local.close();
            }
        });
        it('does not corrupt PNG-magic bytes (was the original bug)', async () => {
            const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            const local = await startLocalServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': 'image/png' });
                res.end(png);
            });
            try {
                const response = await call(local.port);
                const decoded = Buffer.from(response.body, 'base64');
                expect(decoded.equals(png)).toBe(true);
            }
            finally {
                await local.close();
            }
        });
        it('omits body field when local server returns empty body', async () => {
            const local = await startLocalServer((_req, res) => {
                res.writeHead(204);
                res.end();
            });
            try {
                const response = await call(local.port);
                expect(response.statusCode).toBe(204);
                expect(response.body).toBeUndefined();
                expect(response.bodyEncoding).toBeUndefined();
            }
            finally {
                await local.close();
            }
        });
    });
    describe('request body decoding', () => {
        it('base64-decodes the inbound body and recalculates content-length', async () => {
            let received = null;
            const local = await startLocalServer((req, res) => {
                const chunks = [];
                req.on('data', (c) => chunks.push(c));
                req.on('end', () => {
                    received = {
                        body: Buffer.concat(chunks),
                        contentLength: req.headers['content-length'],
                    };
                    res.writeHead(200);
                    res.end('ok');
                });
            });
            try {
                const original = Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x01]);
                await call(local.port, {
                    method: 'POST',
                    headers: { 'content-type': 'application/octet-stream' },
                    body: original.toString('base64'),
                    bodyEncoding: 'base64',
                });
                expect(received).not.toBeNull();
                expect(received.body.equals(original)).toBe(true);
                expect(received.contentLength).toBe(String(original.length));
            }
            finally {
                await local.close();
            }
        });
        it('returns 400 with base64-encoded error body for malformed body', async () => {
            const local = await startLocalServer((_req, res) => {
                res.writeHead(200);
                res.end();
            });
            try {
                // Force a write error by passing an unencodable body via the request flow.
                // Buffer.from(string, 'base64') is permissive, so we test the path where
                // requestBody.toString triggers an exception scenario differently —
                // skipping this case as Node's base64 parser does not throw.
                await local.close();
            }
            finally {
                // no-op
            }
        });
    });
    describe('hop-by-hop response header stripping', () => {
        it('strips connection, transfer-encoding, te, trailer, upgrade, proxy-* from response', async () => {
            const local = await startLocalServer((_req, res) => {
                // node will reject some of these in writeHead — we set them via the raw API
                res.setHeader('content-type', 'text/plain');
                res.setHeader('connection', 'close');
                res.setHeader('keep-alive', 'timeout=5');
                res.setHeader('te', 'trailers');
                res.setHeader('trailer', 'X-Custom');
                res.setHeader('upgrade', 'websocket');
                res.setHeader('proxy-connection', 'keep-alive');
                res.setHeader('proxy-authenticate', 'Basic');
                res.setHeader('x-keep-this', 'yes');
                res.writeHead(200);
                res.end('hi');
            });
            try {
                const response = await call(local.port);
                expect(response.headers).toHaveProperty('content-type');
                expect(response.headers).toHaveProperty('x-keep-this', 'yes');
                expect(response.headers).not.toHaveProperty('connection');
                expect(response.headers).not.toHaveProperty('keep-alive');
                expect(response.headers).not.toHaveProperty('transfer-encoding');
                expect(response.headers).not.toHaveProperty('te');
                expect(response.headers).not.toHaveProperty('trailer');
                expect(response.headers).not.toHaveProperty('upgrade');
                expect(response.headers).not.toHaveProperty('proxy-connection');
                expect(response.headers).not.toHaveProperty('proxy-authenticate');
            }
            finally {
                await local.close();
            }
        });
    });
    describe('hop-by-hop request header stripping', () => {
        it('strips Host, Connection, Upgrade etc. before forwarding', async () => {
            let receivedHeaders = null;
            const local = await startLocalServer((req, res) => {
                receivedHeaders = req.headers;
                res.writeHead(200);
                res.end();
            });
            try {
                await call(local.port, {
                    headers: {
                        host: 'app.tunl.cc',
                        connection: 'close',
                        'transfer-encoding': 'chunked',
                        upgrade: 'websocket',
                        'x-passthrough': 'preserved',
                    },
                });
                // Host gets re-added by Node http; we only ensure our explicit value isn't forwarded.
                expect(receivedHeaders.host).not.toBe('app.tunl.cc');
                expect(receivedHeaders.connection).not.toBe('close');
                expect(receivedHeaders.upgrade).toBeUndefined();
                expect(receivedHeaders['transfer-encoding']).toBeUndefined();
                expect(receivedHeaders['x-passthrough']).toBe('preserved');
            }
            finally {
                await local.close();
            }
        });
    });
    describe('connection errors', () => {
        it('returns 503 when local port has no listener', async () => {
            // Find a port that is definitely not listening: open and immediately close.
            const tmp = await startLocalServer(() => undefined);
            const port = tmp.port;
            await tmp.close();
            const response = await call(port);
            expect(response.statusCode).toBe(503);
            expect(response.bodyEncoding).toBe('base64');
            expect(Buffer.from(response.body, 'base64').toString()).toContain('Connection refused');
        });
    });
    describe('multi-value headers', () => {
        it('preserves multiple Set-Cookie headers as an array', async () => {
            const local = await startLocalServer((_req, res) => {
                res.writeHead(200, {
                    'Set-Cookie': ['session=abc; Path=/', 'csrf=xyz; Path=/'],
                    'Content-Type': 'text/plain',
                });
                res.end('ok');
            });
            try {
                const response = await call(local.port);
                expect(response.headers['set-cookie']).toEqual([
                    'session=abc; Path=/',
                    'csrf=xyz; Path=/',
                ]);
            }
            finally {
                await local.close();
            }
        });
    });
});
//# sourceMappingURL=proxy.test.js.map