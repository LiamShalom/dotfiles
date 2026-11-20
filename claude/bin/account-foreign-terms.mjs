#!/usr/bin/env node
// account-foreign-terms.mjs <companyId>
// Prints JSON: the company's name, the other SideShift company accounts with the same name, and the
// campaign names of those other accounts (normalized, minus names the company itself uses). slack-eyes
// stores it with a channel's account scope, and the reply checks refuse text that names any of them
// (j2 melaxin 11-20: a reply named another "Dr. Melaxin" account's campaigns in J2's channel).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
export const normalize = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// Short or generic names would match ordinary words.
const MIN_TERM = 8

function serviceAccount() {
  const env = readFileSync(join(HOME, '.config/sideshift/env.local'), 'utf8')
  const line = env.split('\n').find((l) => l.startsWith('GOOGLE_SERVICE_ACCOUNT_JSON='))
  if (!line) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON missing from ~/.config/sideshift/env.local')
  let value = line.slice('GOOGLE_SERVICE_ACCOUNT_JSON='.length).trim()
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"') && !value.startsWith('"{'))) value = value.slice(1, -1)
  return JSON.parse(value)
}

export async function foreignTerms(companyId) {
  const require = createRequire(join(HOME, 'sideshift-monorepo/package.json'))
  const admin = require('firebase-admin')
  const app = admin.apps.find((a) => a?.name === 'foreign-terms') ?? admin.initializeApp({ credential: admin.credential.cert(serviceAccount()) }, 'foreign-terms')
  const db = app.firestore()
  const own = await db.doc(`users/${companyId}`).get()
  const name = own.get('name')
  if (!own.exists || typeof name !== 'string' || !name.trim()) throw new Error(`users/${companyId} has no name`)
  const same = await db.collection('users').where('name', '==', name).select('type').get()
  const others = same.docs.map((d) => d.id).filter((id) => id !== companyId)
  const namesOf = async (ids) => {
    const out = []
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await db.collection('programs').where('companyId', 'in', ids.slice(i, i + 30)).select('name').get()
      out.push(...snap.docs.map((d) => d.get('name')).filter((n) => typeof n === 'string'))
    }
    return out
  }
  const ownNames = (await namesOf([companyId])).map(normalize)
  const brand = normalize(name)
  // A reply shortens names ("Germany UGC" for "Germany - UGC - SideShift"): the name without its last
  // word counts too, unless the company's own campaign names use it.
  const forms = (others.length ? await namesOf(others) : []).map(normalize).flatMap((t) => {
    const words = t.split(' ')
    return words.length >= 3 ? [t, words.slice(0, -1).join(' ')] : [t]
  })
  // Creators on the other accounts' contracts, minus creators the company has too.
  const creatorsOf = async (ids) => {
    const out = []
    for (let i = 0; i < ids.length; i += 30) {
      const snap = await db.collection('contractsv2').where('companyId', 'in', ids.slice(i, i + 30)).select('contractorName').get()
      out.push(...snap.docs.map((d) => d.get('contractorName')).filter((n) => typeof n === 'string'))
    }
    return out.map(normalize)
  }
  const ownCreators = new Set(await creatorsOf([companyId]))
  const creators = (others.length ? await creatorsOf(others) : []).filter((c) => c.split(' ').length >= 2 && !ownCreators.has(c))
  // Who owns each other account (an agency): "UGC World Agency". SideShift itself is the platform's name.
  const owners = []
  for (const id of others) {
    const parent = (await db.doc(`users/${id}`).get()).get('parentCompanyId')
    const owner = parent ? (await db.doc(`users/${parent}`).get()).get('name') : null
    if (typeof owner === 'string' && normalize(owner) !== 'sideshift') {
      const words = normalize(owner).split(' ')
      owners.push(normalize(owner), ...(words.length >= 3 ? [words.slice(0, -1).join(' ')] : []))
    }
  }
  const terms = [...new Set([...forms, ...creators, ...owners])]
    .filter((t) => t.length >= MIN_TERM && t !== brand && !ownNames.some((own) => ` ${own} `.includes(` ${t} `)))
  await app.delete()
  return { companyId, name, others, terms, at: new Date().toISOString() }
}

if (process.argv[1]?.endsWith('account-foreign-terms.mjs')) {
  const id = process.argv[2]
  if (!id) { console.error('usage: account-foreign-terms.mjs <companyId>'); process.exit(2) }
  foreignTerms(id).then((r) => console.log(JSON.stringify(r)), (e) => { console.error(`account-foreign-terms: ${e.message ?? e}`); process.exit(1) })
}
