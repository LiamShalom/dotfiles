import test from 'node:test';
import assert from 'node:assert/strict';
import { codeForSite, decodeAttributedBody } from './agent-sms.mjs';

// A minimal typedstream body the way Messages writes it: class name, "+" tag, length, UTF-8 text.
function body(text) {
  const bytes = Buffer.from(text, 'utf8');
  const len = bytes.length < 0x80 ? Buffer.from([bytes.length])
    : Buffer.concat([Buffer.from([0x81]), Buffer.from([bytes.length & 0xff, bytes.length >> 8])]);
  return Buffer.concat([Buffer.from('\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+', 'latin1'),
    len, bytes, Buffer.from('\x86\x84\x02iI', 'latin1')]);
}

test('decodes short and long attributedBody strings', () => {
  assert.equal(decodeAttributedBody(body('Your code is 123456')), 'Your code is 123456');
  const long = `LinkedIn: ${'x'.repeat(200)} 654321 is your code`;
  assert.equal(decodeAttributedBody(body(long)), long);
  assert.equal(decodeAttributedBody(Buffer.from('no class name here')), '');
});

test('takes a code only from a text that names the page site', () => {
  assert.equal(codeForSite('Your LinkedIn verification code is 482913.', 'www.linkedin.com'), '482913');
  assert.equal(codeForSite('Your LinkedIn verification code is 482913.', 'github.com'), '');
  assert.equal(codeForSite('Your verification code is 482913.', 'www.linkedin.com'), '');
});

test('a one-letter site name must stand alone as a word', () => {
  assert.equal(codeForSite('Your Xbox code is 551234', 'x.com'), '');
  assert.equal(codeForSite('Use 551234 to verify your X account.', 'x.com'), '551234');
  assert.equal(codeForSite('Your Robinhood code is 551234', 'x.com'), '');
});

test('reads Google G- codes and spaced site names', () => {
  assert.equal(codeForSite('G-731904 is your Google verification code.', 'accounts.google.com'), '731904');
  assert.equal(codeForSite('Your Side Shift login code: 300912', 'app.sideshift.app'), '300912');
});

test('a domain-bound line decides by its domain', () => {
  assert.equal(codeForSite('Your code is 918273\n\n@example.com #918273', 'login.example.com'), '918273');
  assert.equal(codeForSite('Your example code is 918273\n\n@evil.test #918273', 'example.com'), '');
});

test('the page code length filters candidates', () => {
  assert.equal(codeForSite('Robinhood: 4821 or 482193 is your code', 'robinhood.com', 6), '482193');
  assert.equal(codeForSite('Your Robinhood code is 4821', 'robinhood.com', 6), '');
});
