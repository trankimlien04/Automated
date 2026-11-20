const puppeteer = require('../node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:8088/login', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  // Click Độc giả button
  const buttons = await page.$$('button');
  for (const b of buttons) {
    const text = await page.evaluate(el => el.textContent, b);
    if (text && text.includes('Độc giả')) {
      console.log('Found Độc giả button, clicking...');
      await b.click();
      break;
    }
  }

  await new Promise(r => setTimeout(r, 600));

  // Check email and password input values
  const emailVal = await page.$eval('input[type="email"]', el => el.value);
  const passVal = await page.$eval('input[type="password"]', el => el.value);
  console.log('Inputs filled:', { emailVal, passVal });

  // Click submit
  const submitBtns = await page.$$('button[type="submit"]');
  console.log('Submit buttons found:', submitBtns.length);
  if (submitBtns.length > 0) {
    await submitBtns[0].click();
  }

  await new Promise(r => setTimeout(r, 3000));
  console.log('Current URL after submit:', page.url());

  // Check any toast or text
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('Body snippet:', bodyText.substring(0, 300));

  await browser.close();
})();

