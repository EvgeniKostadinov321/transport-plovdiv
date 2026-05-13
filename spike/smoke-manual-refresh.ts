import { chromium } from 'playwright'

const main = async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.leaflet-interactive', { timeout: 10000 })

  console.log('Open popup...')
  await page.locator('.leaflet-interactive').nth(200).click({ force: true })
  await page.waitForSelector('.eta-table tbody tr', { timeout: 10000 })

  // Изчакваме няколко секунди за да се акумулира age
  console.log('Wait 5 seconds for age to grow...')
  await page.waitForTimeout(5000)

  const ageBefore = await page.locator('.eta-popup__footer > span').first().textContent()
  console.log(`Footer before manual refresh: "${ageBefore}"`)

  // Click refresh button и веднага измерваме spinner
  console.log('\nClick refresh button...')
  const refreshBtn = page.locator('.eta-popup__refresh-btn')
  const t0 = Date.now()
  await refreshBtn.click()

  // Spinner трябва да е видим
  await page.waitForSelector('.eta-popup__refresh-btn .spinning', { timeout: 1000 })
  console.log(`  spinner visible after ${Date.now() - t0}ms`)

  // Изчакваме spinner-ът да изчезне (= зареждането приключи)
  await page.waitForSelector('.eta-popup__refresh-btn .spinning', {
    state: 'detached',
    timeout: 10000,
  })
  console.log(`  spinner gone after ${Date.now() - t0}ms`)

  // Age трябва да е reset-нат
  const ageAfter = await page.locator('.eta-popup__footer > span').first().textContent()
  console.log(`Footer after manual refresh: "${ageAfter}"`)

  await page.screenshot({ path: 'spike/popup-after-refresh.png' })
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
