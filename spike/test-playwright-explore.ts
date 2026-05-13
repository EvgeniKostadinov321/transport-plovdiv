/**
 * Spike v7 phase 1 — Playwright exploration на line-based workflow
 *
 * Цел: Записваме точно какво се случва когато потребител:
 *   1. Кликне „ТЪРСЕНЕ ПО ЛИНИЯ И МАРШРУТ"
 *   2. Избере линия (напр. 18)
 *   3. Избере посока (route)
 *   4. Виж ordered list of stops
 *
 * Изходи:
 *   - Records на AU заявки/responses (от network listener)
 *   - Скрийншоти на всяка стъпка
 *   - DOM snapshot на ordered stops list
 *
 * Run: npx tsx spike/test-playwright-explore.ts
 */

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const RESPONSES_DIR = join(process.cwd(), 'spike', 'responses')
const SHOTS_DIR = join(RESPONSES_DIR, 'playwright')

async function main() {
  await mkdir(SHOTS_DIR, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    locale: 'bg-BG',
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()

  // Capture AU requests
  const auRequests: { url: string; method: string; body: string; status: number; respBody: string }[] = []
  page.on('request', async (req) => {
    if (req.url().includes('/zkau')) {
      const body = req.postData() ?? ''
      // Запис ще е попълнен в respHandler по-долу
      auRequests.push({
        url: req.url(),
        method: req.method(),
        body,
        status: 0,
        respBody: '',
      })
    }
  })
  page.on('response', async (resp) => {
    if (resp.url().includes('/zkau') && resp.request().method() === 'POST') {
      try {
        const text = await resp.text()
        const matching = auRequests.find(
          (r) => r.url === resp.url() && r.status === 0 && r.body === (resp.request().postData() ?? '')
        )
        if (matching) {
          matching.status = resp.status()
          matching.respBody = text
        }
      } catch (err) {
        // Sometimes response body is not available
      }
    }
  })

  console.log('[1] Loading transport.plovdiv.bg/desktop/')
  await page.goto('http://transport.plovdiv.bg/desktop/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  // Изчакваме ZK да инициализира
  await page.waitForSelector('#lines_line', { timeout: 15000 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: join(SHOTS_DIR, '01-initial.png'), fullPage: true })
  console.log('  screenshot saved')

  // Изчакваме инициализация на ZK
  await page.waitForTimeout(2000)

  console.log('[2] Клик върху „ТЪРСЕНЕ ПО ЛИНИЯ И МАРШРУТ"')
  // По-точно target-иране - the button има id 'lines_line'
  const linesButton = page.locator('#lines_line')
  console.log('  button count:', await linesButton.count())
  await linesButton.click({ force: true })
  await page.waitForTimeout(3000)
  await page.screenshot({ path: join(SHOTS_DIR, '02-after-lines-click.png'), fullPage: true })

  // Проверка: lines_list_list трябва вече да е visible
  const linesListVisible = await page.locator('#lines_list_list').isVisible()
  console.log('  lines_list_list visible:', linesListVisible)

  console.log('[3] Избираме „Линия 18"')
  // Скролваме до Linия 18 в listbox-а
  const line18 = page.locator('#lines_list_list >> text=/^Линия 18$/').first()
  await line18.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
  await line18.waitFor({ timeout: 10000, state: 'attached' })
  await line18.click({ force: true })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: join(SHOTS_DIR, '03-after-line-18.png'), fullPage: true })

  console.log('[4] Сканираме DOM за route options (маршрути)')
  const routesHTML = await page.locator('body').innerHTML()
  await writeFile(join(SHOTS_DIR, '03-dom-after-line.html'), routesHTML)

  // Намираме listbox с маршрути - има id 'lines_routes_list_list'
  const routes = await page.locator('[id*="lines_routes_list"] tr, [id*="lines_routes"] li').allTextContents()
  console.log('  routes found:', routes.length, routes.slice(0, 5))

  // Опитваме се да кликнем първия маршрут (направление А)
  console.log('[5] Избираме първия маршрут')
  const firstRouteItem = page
    .locator('[id*="lines_routes"] >> [class*="listitem"], [id*="lines_routes"] tr')
    .first()
  if (await firstRouteItem.isVisible().catch(() => false)) {
    await firstRouteItem.click()
    await page.waitForTimeout(2000)
    await page.screenshot({
      path: join(SHOTS_DIR, '04-after-route-select.png'),
      fullPage: true,
    })
  } else {
    console.log('  route item not directly clickable - searching for alternative')
    // Опит чрез текстов клик - вземаме първото нещо с текст напр. „ПУ" или „Колелото"
    const possible = await page.locator('text=/Колелото|ПУ -|АПК|Прослав|Тракия|Център/i').allTextContents()
    console.log('  possible route labels:', possible)
  }

  console.log('[6] Извличаме ordered stops list')
  const stopsListHTML = await page
    .locator('[id*="lines_stops_list_list"]')
    .innerHTML()
    .catch(() => 'NOT FOUND')
  await writeFile(join(SHOTS_DIR, '05-stops-list-dom.html'), stopsListHTML)

  // Извлечи текстови labels от ordered list
  const stopTexts = await page
    .locator('[id*="lines_stops_list_list"] [class*="listcell-cnt"], [id*="lines_stops_list"] td')
    .allTextContents()
    .catch(() => [])
  console.log('  ordered stops (raw):', stopTexts.length, stopTexts.slice(0, 10))

  // Запази AU recording-а
  await writeFile(
    join(SHOTS_DIR, '00-au-trace.json'),
    JSON.stringify(auRequests, null, 2)
  )
  console.log('\n[done] AU requests recorded:', auRequests.length)

  await browser.close()
}

main().catch((err) => {
  console.error('Spike crashed:', err)
  process.exit(1)
})
