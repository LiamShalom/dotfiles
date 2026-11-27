import test from 'node:test';
import assert from 'node:assert/strict';
import {saveTestLogin} from './agent-login-core.mjs';

const vaults = JSON.stringify([{id:'qa',name:'Agent-Test'},{id:'personal',name:'Agent Logins'}]);

test('creates a new Agent-Test login with secrets in the template only, never argv', () => {
  const calls = [];
  const op = (args, input) => {
    calls.push({args, input});
    if (args[0] === 'vault') return vaults;
    if (args[1] === 'list') return JSON.stringify([]);
    if (args[1] === 'create') return JSON.stringify({id:'new1', fields:[{purpose:'PASSWORD', value:'s3cret'}]});
    throw new Error(`unexpected ${args}`);
  };
  const out = saveTestLogin({title:'X QA', url:'https://x.com/login', username:'qa@example.test', password:'s3cret'}, op);
  assert.deepEqual(out, {id:'new1', title:'X QA', vault:'Agent-Test', action:'created'});
  assert.ok(calls.every(c => !c.args.includes('personal')));
  assert.ok(calls.every(c => !c.args.join(' ').includes('s3cret')));
  const sent = JSON.parse(calls.find(c => c.args[1] === 'create').input);
  assert.equal(sent.fields.find(f => f.purpose === 'PASSWORD').value, 's3cret');
  assert.equal(sent.urls[0].href, 'https://x.com/login');
});

test('updates an existing login by title and keeps its other fields', () => {
  let sent;
  const op = (args, input) => {
    if (args[0] === 'vault') return vaults;
    if (args[1] === 'list') return JSON.stringify([{id:'old1', title:'X QA'}]);
    if (args[1] === 'get') return JSON.stringify({id:'old1', title:'X QA', urls:[{href:'https://x.com/'}], fields:[
      {purpose:'USERNAME', value:'old@example.test'}, {purpose:'PASSWORD', value:'old'}, {type:'OTP', value:'otpauth://x'}]});
    if (args[1] === 'edit') { sent = JSON.parse(input); return '{}'; }
    throw new Error(`unexpected ${args}`);
  };
  const out = saveTestLogin({title:'x qa', url:'https://x.com/', username:'new@example.test', password:'new'}, op);
  assert.equal(out.action, 'updated');
  assert.equal(sent.fields.find(f => f.purpose === 'USERNAME').value, 'new@example.test');
  assert.equal(sent.fields.find(f => f.purpose === 'PASSWORD').value, 'new');
  assert.ok(sent.fields.some(f => f.type === 'OTP'));
  assert.equal(sent.urls.length, 1);
});

test('refuses non-https sites and missing values before calling 1Password', () => {
  const op = () => { throw new Error('should not run'); };
  assert.throws(() => saveTestLogin({title:'a', url:'http://x.com', username:'u', password:'p'}, op), /https/);
  assert.throws(() => saveTestLogin({title:'a', url:'https://x.com', username:'u', password:''}, op), /required/);
});
