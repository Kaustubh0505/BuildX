const { MongoClient } = require('mongodb')
const { createApi } = require('./app.cjs')

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in the server environment.')
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  try {
    await client.connect()
    const db = client.db(process.env.MONGODB_DATABASE || 'buildx')
    const app = await createApi({ db })
    const server = app.listen(Number(process.env.PORT || 3001), process.env.HOST || '127.0.0.1')
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
    console.log('BuildX API ready.')
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(async () => { await client.close(); process.exit(0) }))
  } catch (error) { await client.close(); throw error }
}
start().catch((error) => {
  let message = 'BuildX API could not start. Check server configuration and database availability.'
  if ([18, 8000].includes(error.code) || /authentication|bad auth/i.test(error.message)) message = 'MongoDB authentication failed. Verify your Atlas Database Access user/password and URL-encode reserved characters in MONGODB_URI.'
  else if (error.code === 13297) message = 'MongoDB database name casing conflicts with an existing database. Set MONGODB_DATABASE to the exact existing name, including uppercase and lowercase letters.'
  else if (['ENOTFOUND', 'ENODATA'].includes(error.code)) message = 'MongoDB DNS lookup failed. Check the cluster hostname and credential encoding in MONGODB_URI.'
  else if (error.name === 'MongoServerSelectionError') message = 'MongoDB could not be reached. Check connectivity and the Atlas Network Access IP allowlist.'
  else if (error.name === 'MongoParseError') message = 'MONGODB_URI is invalid. Check the connection string format and credential encoding.'
  else if (error.code === 'EADDRINUSE') message = 'The BuildX API port is already in use.'
  console.error(message)
  process.exitCode = 1
})
