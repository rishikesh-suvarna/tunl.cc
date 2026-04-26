"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const response_builder_1 = require("../../src/server/response-builder");
describe('buildHttpResponse', () => {
    describe('headers', () => {
        it('returns empty headers when input is undefined', () => {
            const result = (0, response_builder_1.buildHttpResponse)(200);
            expect(result.headers).toEqual({});
        });
        it('lowercases all header keys to prevent case-conflicting duplicates', () => {
            const result = (0, response_builder_1.buildHttpResponse)(200, {
                'Content-Type': 'application/json',
                'X-Custom-Header': 'value',
            });
            expect(result.headers).toEqual({
                'content-type': 'application/json',
                'x-custom-header': 'value',
            });
        });
        it('does NOT inject default Content-Type when headers omit it', () => {
            const result = (0, response_builder_1.buildHttpResponse)(200, { 'x-foo': 'bar' });
            expect(result.headers).not.toHaveProperty('content-type');
            expect(result.headers).not.toHaveProperty('Content-Type');
        });
        it('preserves array-valued headers (Set-Cookie)', () => {
            const result = (0, response_builder_1.buildHttpResponse)(200, {
                'set-cookie': ['a=1', 'b=2'],
            });
            expect(result.headers['set-cookie']).toEqual(['a=1', 'b=2']);
        });
        it('drops undefined header values', () => {
            const result = (0, response_builder_1.buildHttpResponse)(200, {
                'x-defined': 'yes',
                'x-undefined': undefined,
            });
            expect(result.headers).toEqual({ 'x-defined': 'yes' });
        });
    });
    describe('body', () => {
        it('returns empty string when no body', () => {
            const result = (0, response_builder_1.buildHttpResponse)(200);
            expect(result.body).toBe('');
        });
        it('decodes base64 body to a Buffer when bodyEncoding is base64', () => {
            const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0xff]);
            const result = (0, response_builder_1.buildHttpResponse)(200, undefined, original.toString('base64'), 'base64');
            expect(Buffer.isBuffer(result.body)).toBe(true);
            expect(result.body.equals(original)).toBe(true);
        });
        it('round-trips arbitrary binary bytes byte-perfect', () => {
            const bytes = Buffer.alloc(256);
            for (let i = 0; i < 256; i++)
                bytes[i] = i;
            const result = (0, response_builder_1.buildHttpResponse)(200, undefined, bytes.toString('base64'), 'base64');
            expect(result.body.equals(bytes)).toBe(true);
        });
        it('falls back to raw string when bodyEncoding is missing (legacy clients)', () => {
            const result = (0, response_builder_1.buildHttpResponse)(200, undefined, 'hello world');
            expect(result.body).toBe('hello world');
        });
    });
    describe('statusCode', () => {
        it('passes through 2xx/3xx/4xx/5xx', () => {
            expect((0, response_builder_1.buildHttpResponse)(204).statusCode).toBe(204);
            expect((0, response_builder_1.buildHttpResponse)(301).statusCode).toBe(301);
            expect((0, response_builder_1.buildHttpResponse)(404).statusCode).toBe(404);
            expect((0, response_builder_1.buildHttpResponse)(503).statusCode).toBe(503);
        });
        it('defaults to 200 when statusCode is 0/falsy', () => {
            expect((0, response_builder_1.buildHttpResponse)(0).statusCode).toBe(200);
        });
    });
});
describe('bodyByteLength', () => {
    it('returns Buffer length for buffers', () => {
        expect((0, response_builder_1.bodyByteLength)(Buffer.from('abc'))).toBe(3);
        expect((0, response_builder_1.bodyByteLength)(Buffer.from([0xff, 0xff, 0xff]))).toBe(3);
    });
    it('returns UTF-8 byte length for strings (multi-byte aware)', () => {
        expect((0, response_builder_1.bodyByteLength)('abc')).toBe(3);
        expect((0, response_builder_1.bodyByteLength)('ümlaut')).toBe(7);
        expect((0, response_builder_1.bodyByteLength)('')).toBe(0);
    });
});
//# sourceMappingURL=response-builder.test.js.map