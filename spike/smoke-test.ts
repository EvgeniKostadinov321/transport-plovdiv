import { chromium } from 'playwright'

const main = async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.leaflet-interactive', { timeout: 10000 })

  const markers = page.locator('.leaflet-interactive')
  const count = await markers.count()
  console.log(`Markers: ${count}`)

  // Тест 1: cold click (никакъв prefetch)
  console.log('\n[Тест 1] Cold click (без hover)')
  const marker1 = markers.nth(50)
  const t1 = Date.now()
  await marker1.click()
  await page.waitForSelector('.leaflet-popup-content table', { timeout: 10000 })
  console.log(`  popup ready in ${Date.now() - t1}ms`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // Тест 2: hover първо, после click
  console.log('\n[Тест 2] Hover prefetch + click')
  const marker2 = markers.nth(100)
  await marker2.hover()
  console.log('  hover started, waiting 1.5s for prefetch...')
  await page.waitForTimeout(1500)
  const t2 = Date.now()
  await marker2.click()
  await page.waitForSelector('.leaflet-popup-content table', { timeout: 10000 })
  console.log(`  popup ready in ${Date.now() - t2}ms`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // Тест 3: re-click на същата спирка (cache hit)
  console.log('\n[Тест 3] Re-click на същата спирка (client+server cache)')
  // Премахваме съществуващ popup ако още е там
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(500)
  // Кликваме отново marker2
  const t3 = Date.now()
  // Re-locate защото DOM може да се е променил
  const marker2again = page.locator('.leaflet-interactive').nth(100)
  await marker2again.click({ force: true })
  await page.waitForSelector('.leaflet-popup-content table', { timeout: 10000 })
  console.log(`  popup ready in ${Date.now() - t3}ms`)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
