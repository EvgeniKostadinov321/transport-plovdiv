import { chromium } from 'playwright'

const main = async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.leaflet-interactive', { timeout: 10000 })

  // Целим спирка #304 - която на screenshot-а на user-а беше с много автобуси
  // Намираме я програмно
  await page.evaluate(() => {
    const stops = (window as any).__STOPS__ as Array<{ number: number; lat: number; lng: number }>
    return stops
  })

  // По-просто: кликни няколко маркера докато не намериш с >5 автобуса
  for (let i = 200; i < 350; i += 10) {
    await page.locator('.leaflet-interactive').nth(i).click({ force: true })
    try {
      await page.waitForSelector('.eta-table tbody tr', { timeout: 5000 })
      const rows = await page.locator('.eta-table tbody tr').count()
      if (rows >= 8) {
        console.log(`Marker ${i}: ${rows} rows`)
        break
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    } catch {
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(200)
    }
  }

  await page.waitForTimeout(1000) // дай време на CSS
  await page.screenshot({ path: 'spike/popup-design.png', fullPage: false })
  console.log('screenshot: spike/popup-design.png')

  // Crop към popup-а
  const popup = page.locator('.leaflet-popup').first()
  await popup.screenshot({ path: 'spike/popup-design-cropped.png' })
  console.log('cropped: spike/popup-design-cropped.png')

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
