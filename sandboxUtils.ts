import { analyzeImageWithGroq } from './groqUtils.js'

export async function browseAndAnalyze(sandbox: any) {
  console.time('Computer use start')
  const startResult = await sandbox.computerUse.start()
  console.log('Computer use start result:', startResult)
  console.timeEnd('Computer use start')

  console.time('Get preview link')
  const previewLink = await sandbox.getPreviewLink(6080)
  console.log('Computer use preview link:', previewLink.url)
  try {
    const open = (await import('open')).default;
    await open(previewLink.url);
  } catch (error) {
    console.error('Failed to open preview link:', error);
  }
  console.timeEnd('Get preview link')

  console.time('Open browser')
  await sandbox.computerUse.keyboard.press('Super_L')
  await new Promise(resolve => setTimeout(resolve, 500))
  console.time('Launcher screenshot')
  const launcherResp = await sandbox.computerUse.screenshot.takeFullScreen(true)
  console.timeEnd('Launcher screenshot')
  console.time('Launcher - Analyze with Groq')
  await analyzeImageWithGroq(launcherResp.screenshot, 'Launcher')
  console.timeEnd('Launcher - Analyze with Groq')
  await sandbox.computerUse.keyboard.type('firefox')
  await new Promise(resolve => setTimeout(resolve, 500))
  await sandbox.computerUse.keyboard.press('Return')
  console.timeEnd('Open browser')
  await new Promise(resolve => setTimeout(resolve, 3000))
  await navigateAndAnalyze(sandbox, 'https://www.apple.com', 'Apple')
  await navigateAndAnalyze(sandbox, 'https://www.samsung.com', 'Samsung')
}

export async function navigateAndAnalyze(sandbox: any, url: string, label: string) {
  console.time(`${label} - Navigate`)
  await sandbox.computerUse.keyboard.hotkey('ctrl+l')
  await new Promise(resolve => setTimeout(resolve, 500))
  await sandbox.computerUse.keyboard.type(url)
  await new Promise(resolve => setTimeout(resolve, 500))
  await sandbox.computerUse.keyboard.press('Return')
  console.timeEnd(`${label} - Navigate`)
  await new Promise(resolve => setTimeout(resolve, 4000))
  console.time(`${label} - Screenshot`)
  const resp = await sandbox.computerUse.screenshot.takeFullScreen(true)
  console.timeEnd(`${label} - Screenshot`)
  console.time(`${label} - Analyze with Groq`)
  await analyzeImageWithGroq(resp.screenshot, label)
  console.timeEnd(`${label} - Analyze with Groq`)
} 