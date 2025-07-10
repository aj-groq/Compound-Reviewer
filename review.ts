import { Daytona } from '@daytonaio/sdk'
import 'dotenv/config'
import { Groq } from 'groq-sdk'
import open from 'open';
import { browseAndAnalyze } from './sandboxUtils.js'


const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const DAYTONA_API_URL = process.env.DAYTONA_API_URL

const groq = new Groq()

async function main() {
  console.time('Total execution time')
  
  console.time('Daytona initialization')
  const daytona = new Daytona({
    apiKey: DAYTONA_API_KEY,
    apiUrl: DAYTONA_API_URL,
  })
  console.timeEnd('Daytona initialization')

  console.time('Sandbox creation')
  const sandbox = await daytona.create({
    envVars: {
      VNC_RESOLUTION: '800x600',
    },
  })
  console.timeEnd('Sandbox creation')

  console.log('sandbox id', sandbox.id)
  console.log('sandbox runner domain', sandbox.runnerDomain)

  try {
    console.time('Computer use operations')
    await browseAndAnalyze(sandbox)
    console.timeEnd('Computer use operations')
  } catch (error) {
    console.error('Error executing commands:', error)
  } finally {
    console.time('Sandbox deletion')
    await daytona.delete(sandbox)
    console.timeEnd('Sandbox deletion')
  }
  
  console.timeEnd('Total execution time')
}

main().catch(console.error)
