const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'http://localhost:4200';
const API_URL = 'http://localhost:3000';

const timestamp = Date.now();
const shortTs = timestamp.toString().slice(-8);
const testUser = {
  username: `e2e_${shortTs}`,
  email: `test_${shortTs}@example.com`,
  password: 'TestPass123!',
  cpf: `${timestamp}`.slice(-11).padStart(11, '1') // Unique CPF per test
};

let accessToken = '';
let refreshToken = '';
let characterId = '';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiPost(endpoint, data, token = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });
  return response.json();
}

async function apiGet(endpoint, token = '') {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${API_URL}${endpoint}`, { headers });
  return response.json();
}

async function runTest() {
  console.log('🚀 Starting E2E test...');
  console.log(`Test user: ${testUser.email}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`❌ Console Error: ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`❌ Page Error: ${error.message}`);
  });

  try {
    // ===== STEP 1: Register new account via API =====
    console.log('\n📝 STEP 1: Register new account via API');
    const registerResponse = await apiPost('/auth/register', {
      username: testUser.username,
      email: testUser.email,
      password: testUser.password,
      cpf: testUser.cpf
    });
    console.log('   Register response:', JSON.stringify(registerResponse).substring(0, 200));
    
    if (registerResponse.accessToken) {
      accessToken = registerResponse.accessToken;
      refreshToken = registerResponse.refreshToken;
      console.log('   ✅ Got access token');
    }

    // ===== STEP 1.5: Create character via API =====
    console.log('\n👤 STEP 1.5: Create character via API');
    if (accessToken) {
      const charResponse = await apiPost('/characters', { username: testUser.username }, accessToken);
      characterId = charResponse.id || charResponse.characterId || '';
      console.log(`   Character created: ${characterId || 'unknown'}`);
      console.log(`   Response:`, JSON.stringify(charResponse).substring(0, 200));
    } else {
      console.log('   ⚠️ No access token found');
    }

    // ===== STEP 2: Login via UI and try to enter map without email verification =====
    console.log('\n🚫 STEP 2: Try to enter map without email verification (via UI)');
    
    // Login via UI
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    
    await page.fill('input[name="username"]', testUser.username);
    await page.fill('input[name="password"]', testUser.password);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    await delay(3000);
    
    console.log(`   After login URL: ${page.url()}`);
    
    // Check localStorage after login
    const tokens = await page.evaluate(() => ({
      accessToken: localStorage.getItem('accessToken'),
      refreshToken: localStorage.getItem('refreshToken')
    }));
    console.log(`   localStorage tokens:`, tokens);
    
    // Navigate to play page
    await page.goto(`${BASE_URL}/play`);
    await page.waitForLoadState('networkidle');
    await delay(2000);
    
    // Get full page HTML for debugging
    const pageHTML = await page.content();
    console.log(`   Page HTML length: ${pageHTML.length}`);
    console.log(`   Page contains "Entrar no mapa": ${pageHTML.includes('Entrar no mapa')}`);
    console.log(`   Page contains "Green Grounds": ${pageHTML.includes('Green Grounds')}`);
    console.log(`   Page contains "NanoMMO": ${pageHTML.includes('NanoMMO')}`);
    console.log(`   Page contains "Logado como": ${pageHTML.includes('Logado como')}`);
    
    // Check page content
    const pageContent = await page.textContent('body');
    console.log(`   Page text content length: ${pageContent.length}`);
    console.log(`   Page text (first 500): ${pageContent.substring(0, 500)}`);
    
    // Take screenshot for debugging
    await page.screenshot({ path: 'step2-play-page.png', fullPage: true });
    console.log('   📸 Screenshot saved: step2-play-page.png');

    // ===== STEP 3: Verify email via Gmail =====
    console.log('\n✉️ STEP 3: Verify email');
    console.log('   Need to get verification token from backend logs or database');
    
    // For now, let's pause and let the user check the email manually
    console.log('   ⏸️  PAUSED: Please check email for verification link');
    console.log('   The verification link should be like: http://localhost:4200/verify-email?token=XXX');
    console.log('   Press Enter after you have the token...');
    
    await page.screenshot({ path: 'step3-before-verify.png', fullPage: true });
    
    // ===== STEP 4: After verification, enter map =====
    console.log('\n✅ STEP 4: Enter map after verification');
    
    // Go to play page again
    await page.goto(`${BASE_URL}/play`);
    await page.waitForLoadState('networkidle');
    await delay(3000);
    
    // Check page content
    const pageHTML2 = await page.content();
    console.log(`   Page HTML length: ${pageHTML2.length}`);
    console.log(`   Page contains "Entrar no mapa": ${pageHTML2.includes('Entrar no mapa')}`);
    console.log(`   Page contains "Green Grounds": ${pageHTML2.includes('Green Grounds')}`);
    console.log(`   Page contains "NanoMMO": ${pageHTML2.includes('NanoMMO')}`);
    console.log(`   Page contains "Logado como": ${pageHTML2.includes('Logado como')}`);
    
    // Try to enter a map
    await page.click('button:has-text("Entrar no mapa")');
    await delay(3000);
    
    // Check result
    const resultText = await page.textContent('body');
    console.log(`   Page content after map enter: ${resultText.substring(0, 500)}`);
    console.log(`   Page contains "Grind Ativo": ${resultText.includes('Grind Ativo')}`);
    console.log(`   Page contains "Em": ${resultText.includes('Em ')}`);
    
    await page.screenshot({ path: 'step4-map-entered.png', fullPage: true });
    console.log('   📸 Screenshot saved: step4-map-entered.png');
    
    // ===== STEP 5: Logout =====
    console.log('\n🚪 STEP 5: Logout');
    
    // Click logout button
    await page.click('button:has-text("Sair")');
    await delay(2000);
    
    console.log(`   After logout URL: ${page.url()}`);
    
    await page.screenshot({ path: 'step5-logout.png', fullPage: true });
    console.log('   📸 Screenshot saved: step5-logout.png');

    // ===== STEP 6: Forgot password =====
    console.log('\n🔑 STEP 6: Forgot password');
    
    await page.goto(`${BASE_URL}/forgot-password`);
    await page.waitForLoadState('networkidle');
    await delay(1000);
    
    await page.fill('input[name="email"]', testUser.email);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    await delay(3000);
    
    const forgotText = await page.textContent('body');
    console.log(`   Forgot password page content: ${forgotText.substring(0, 300)}`);
    console.log(`   Shows generic success message: ${forgotText.includes('If the email exists') || forgotText.includes('enviamos') || forgotText.includes('sent')}`);
    
    await page.screenshot({ path: 'step6-forgot-password.png', fullPage: true });
    console.log('   📸 Screenshot saved: step6-forgot-password.png');

    // ===== STEP 7: Reset password via email =====
    console.log('\n🔐 STEP 7: Reset password');
    console.log('   Need to get reset token from backend logs or database');
    
    // Get reset token from database
    console.log('   ⏸️  PAUSED: Please check email for reset password link');
    console.log('   The reset link should be like: http://localhost:4200/reset-password?token=XXX');
    console.log('   Press Enter after you have the token...');
    
    await page.screenshot({ path: 'step7-before-reset.png', fullPage: true });
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'error.png', fullPage: true });
  } finally {
    // await browser.close();
  }
}

runTest().catch(console.error);