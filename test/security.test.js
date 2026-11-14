const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { detectFileTypeByMagicBytes, createQrCredential } = require('../src/middlewares/security');

test('recognizes supported file signatures and rejects other input', () => {
  assert.equal(detectFileTypeByMagicBytes(Buffer.from('%PDF-1.7')).type, 'pdf');
  assert.equal(detectFileTypeByMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).type, 'jpg');
  assert.equal(detectFileTypeByMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).type, 'png');
  assert.equal(detectFileTypeByMagicBytes(Buffer.from('nope')), null);
});

test('QR credential stores a SHA-256 hash rather than the raw token', () => {
  const credential = createQrCredential();
  assert.equal(credential.tokenHash, crypto.createHash('sha256').update(credential.token).digest('hex'));
  assert.notEqual(credential.token, credential.tokenHash);
});
