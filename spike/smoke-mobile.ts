import { chromium, devices } from 'playwright'

const main = async () => {
  const browser = await chromium.launch({ headless: true })
  const iPhone = devices['iPhone 13']
  const ctx = await browser.newContext({ ...iPhone })
  const page = await ctx.newPage()

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.leaflet-interactive', { timeout: 10000 })

  await page.screenshot({ path: 'spike/mobile-1-map.png' })

  // Намираме видим маркер близо до центъра
  const markers = page.locator('.leaflet-interactive')
  const total = await markers.count()
  console.log(`Total markers: ${total}`)
  for (let i = 0; i < total; i++) {
    const marker = markers.nth(i)
    const visible = await marker.isVisible().catch(() => false)
    if (!visible) continue
    const box = await marker.boundingBox().catch(() => null)
    if (!box) continue
    // Проверяваме дали е в viewport-а
    if (box.x < 50 || box.x > 350 || box.y < 100 || box.y > 600) continue
    try {
      await marker.tap()
      await page.waitForSelector('.eta-table tbody tr', { timeout: 5000 })
      const rows = await page.locator('.eta-table tbody tr').count()
      console.log(`Marker ${i}: ${rows} rows`)
      if (rows >= 8) break
    } catch {}
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(200)
  }

  await page.waitForTimeout(800)
  await page.screenshot({ path: 'spike/mobile-2-popup.png' })

  // Scroll вътре в sheet-а
  await page
    .locator('.eta-table__scroll')
    .evaluate((el) => {
      el.scrollTop = 200
    })
    .catch(() => {})
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'spike/mobile-3-scrolled.png' })

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
