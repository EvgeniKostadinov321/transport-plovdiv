import { chromium } from 'playwright'

const main = async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  // Брояч на ETA API заявки
  let etaRequests = 0
  page.on('request', (req) => {
    if (req.url().includes('/api/eta/')) {
      etaRequests++
      console.log(`  [REQ ${etaRequests}] ${req.url()} at ${new Date().toISOString().slice(11, 19)}`)
    }
  })

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.leaflet-interactive', { timeout: 10000 })

  console.log('Click marker, open popup')
  await page.locator('.leaflet-interactive').nth(100).click({ force: true })
  await page.waitForSelector('.leaflet-popup-content table', { timeout: 10000 })

  console.log('\nКеширан footer test:')
  const footer1 = await page.locator('.leaflet-popup-content > div > div').last().textContent()
  console.log(`  ${footer1}`)

  console.log('\nИзчакваме 35 сек да видим auto-refresh...')
  await page.waitForTimeout(35_000)

  const footer2 = await page.locator('.leaflet-popup-content > div > div').last().textContent()
  console.log(`  ${footer2}`)

  console.log(`\nETA requests за този период: ${etaRequests}`)
  console.log(`Очаквано: 2 (1 initial + 1 след 30s)`)

  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
