import { chromium } from 'playwright'

const main = async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.leaflet-interactive', { timeout: 10000 })

  // Намираме спирка с много ETAs - кликваме централни спирки
  let found = false
  for (const idx of [0, 50, 100, 150, 200, 250, 300, 350, 400, 250, 280, 304]) {
    const markers = page.locator('.leaflet-interactive')
    const total = await markers.count()
    if (idx >= total) continue
    await markers.nth(idx).click({ force: true })
    try {
      await page.waitForSelector('.eta-table tbody tr', { timeout: 5000 })
      const rows = await page.locator('.eta-table tbody tr').count()
      console.log(`Marker ${idx}: ${rows} rows`)
      if (rows >= 18) {
        found = true
        break
      }
    } catch {}
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)
  }

  if (!found) {
    console.log('Could not find a stop with 18+ ETAs, using current')
  }

  await page.waitForTimeout(1000)

  // Screenshot цял popup
  const popup = page.locator('.leaflet-popup').first()
  await popup.screenshot({ path: 'spike/popup-scroll.png' })
  console.log('full popup -> spike/popup-scroll.png')

  // Scroll-вай вътре в таблицата
  await page.locator('.eta-table__scroll').evaluate((el) => {
    el.scrollTop = 200
  })
  await page.waitForTimeout(300)
  await popup.screenshot({ path: 'spike/popup-scroll-mid.png' })
  console.log('scrolled mid -> spike/popup-scroll-mid.png')

  // Scroll-вай до края
  await page.locator('.eta-table__scroll').evaluate((el) => {
    el.scrollTop = 9999
  })
  await page.waitForTimeout(300)
  await popup.screenshot({ path: 'spike/popup-scroll-end.png' })
  console.log('scrolled end -> spike/popup-scroll-end.png')

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
