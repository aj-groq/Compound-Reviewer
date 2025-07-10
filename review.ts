import { Daytona } from '@daytonaio/sdk'
import 'dotenv/config'
import { Groq } from 'groq-sdk'
import { exec } from 'child_process'

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

async function browseAndAnalyze(sandbox: any) {
  // Start VNC/computer use
  console.time('Computer use start')
  const startResult = await sandbox.computerUse.start()
  console.log('Computer use start result:', startResult)
  console.timeEnd('Computer use start')
  // Get and print computer use status

  console.time('Get preview link')
  const previewLink = await sandbox.getPreviewLink(6080)
  console.log('Computer use preview link:', previewLink.url)
  // Open the preview link locally
  exec(`open "${previewLink.url}"`, (error: any) => {
    if (error) {
      console.error('Error opening preview link:', error)
    } else {
      console.log('Preview link opened locally')
    }
  })
  console.timeEnd('Get preview link')

  // Open browser (Super_L, type 'firefox', Return)
  console.time('Open browser')
  await sandbox.computerUse.keyboard.press('Super_L')
  await new Promise(resolve => setTimeout(resolve, 500))
  // Take screenshot after opening launcher
  console.time('Launcher screenshot')
  const launcherResp = await sandbox.computerUse.screenshot.takeFullScreen(true)
  console.timeEnd('Launcher screenshot')

  // Analyze launcher with Groq
  console.time('Launcher - Analyze with Groq')
  await analyzeImageWithGroq(launcherResp.screenshot, 'Launcher')
  console.timeEnd('Launcher - Analyze with Groq')
  await sandbox.computerUse.keyboard.type('firefox')
  await new Promise(resolve => setTimeout(resolve, 500))
  await sandbox.computerUse.keyboard.press('Return')
  console.timeEnd('Open browser')

  // Wait for browser to load
  await new Promise(resolve => setTimeout(resolve, 3000))

  // --- Apple.com ---
  await navigateAndAnalyze(sandbox, 'https://www.apple.com', 'Apple')

  // --- Samsung.com ---
  await navigateAndAnalyze(sandbox, 'https://www.samsung.com', 'Samsung')
}

async function navigateAndAnalyze(sandbox: any, url: string, label: string) {
  console.time(`${label} - Navigate`)

  await sandbox.computerUse.keyboard.hotkey('ctrl+l')
  await new Promise(resolve => setTimeout(resolve, 500))
  await sandbox.computerUse.keyboard.type(url)
  await new Promise(resolve => setTimeout(resolve, 500))
  await sandbox.computerUse.keyboard.press('Return')
  console.timeEnd(`${label} - Navigate`)

  // Wait for page to load
  await new Promise(resolve => setTimeout(resolve, 4000))

  // Screenshot
  console.time(`${label} - Screenshot`)
  const resp = await sandbox.computerUse.screenshot.takeFullScreen(true)
  console.timeEnd(`${label} - Screenshot`)

  // Analyze with Groq
  console.time(`${label} - Analyze with Groq`)
  await analyzeImageWithGroq(resp.screenshot, label)
  console.timeEnd(`${label} - Analyze with Groq`)
}

async function analyzeImageWithGroq(base64Data: string, label: string) {
  const dataUrl = `data:image/png;base64,${base64Data}`
  const chatCompletion = await groq.chat.completions.create({
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": `Describe the user interface in this image. This is a screenshot of the ${label} homepage.`
          },
          {
            "type": "image_url",
            "image_url": {
              "url": dataUrl
            }
          }
        ]
      }
    ],
    "model": "meta-llama/llama-4-scout-17b-16e-instruct",
    "temperature": 1,
    "max_completion_tokens": 1024,
    "top_p": 1,
    "stream": false,
    "stop": null
  })
  console.log(`Groq response for ${label}:`, chatCompletion.choices[0].message.content)
}

main().catch(console.error)
