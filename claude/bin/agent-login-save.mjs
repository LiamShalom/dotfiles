#!/usr/bin/env node
// Save a test account's login to the Agent-Test vault. The password is read from stdin so it
// never appears in argv or the transcript. Prints only the item id, title, vault and action.
import {saveTestLogin, LoginError} from './agent-login-core.mjs';
import {readFileSync} from 'node:fs';
const [title, url, username] = process.argv.slice(2);
try {
  if (!title || !url || !username || process.argv.length !== 5 || process.stdin.isTTY)
    throw new LoginError('Usage: printf %s "$PASSWORD" | agent-login-save.mjs <title> <https-url> <username>');
  const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  console.log(JSON.stringify(saveTestLogin({title, url, username, password})));
} catch (error) {
  console.error(error instanceof LoginError ? error.message : 'The login could not be saved');
  process.exitCode = error instanceof LoginError ? error.code : 1;
}
