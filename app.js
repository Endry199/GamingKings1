import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://oznmqczxpywvdmefermv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96bm1xY3p4cHl3dmRtZWZlcm12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMyMDg3NzcsImV4cCI6MjA2ODc4NDc3N30.SxB0TpVWDihU6MZwQIG4fT42D9gvWjFQNga93zxRfbc';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = { user: null, balance: 0, currency: 'usd', rate: 0, amount: 10, products: [], transactions: [], banners: [], carouselIndex: 0, pendingRegistration: null, awaitingOtp: false };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function showToast(message, error = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.style.borderColor = error ? 'var(--danger)' : '';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3600);
}

function setAuthMessage(message, error = false) {
  const element = $('#authMessage');
  element.textContent = message;
  element.style.color = error ? 'var(--danger)' : 'var(--green)';
}

async function callFunction(name, body) {
  const response = await fetch(`/.netlify/functions/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
  return data;
}

function openModal(id) { $(`#${id}`).classList.remove('hidden'); }
function closeModal(id) { $(`#${id}`).classList.add('hidden'); }

function setAuthMode(mode) {
  $$('.switch').forEach(button => button.classList.toggle('active', button.dataset.auth === mode));
  $('#loginPanel').classList.toggle('active', mode === 'login');
  $('#registerPanel').classList.toggle('active', mode === 'register');
  setAuthMessage('');
}

function openOtpModal(email, purpose) {
  state.pendingRegistration = { email, purpose };
  let modal = $('#otpModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'otpModal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<section class="modal-card otp-card"><p class="eyebrow">VERIFICACIÓN</p><h2>Confirma que eres tú.</h2><p class="helper">Enviamos un código de 6 dígitos a <strong id="otpEmail"></strong>.</p><label class="otp-label">Código de seguridad<input id="otpCode" inputmode="numeric" maxlength="6" placeholder="000000"></label><p id="otpMessage" class="form-message"></p><button id="verifyOtp" class="button primary full">Verificar código <span>→</span></button><button id="resendOtp" class="button ghost full otp-resend">Enviar otro código</button></section>`;
    document.body.append(modal);
    $('#verifyOtp').addEventListener('click', verifyOtp);
    $('#resendOtp').addEventListener('click', async () => { try { await callFunction('send-otp', { email: state.pendingRegistration.email, purpose: state.pendingRegistration.purpose }); $('#otpMessage').textContent = 'Código enviado nuevamente.'; } catch (error) { $('#otpMessage').textContent = error.message; } });
  }
  $('#otpEmail').textContent = email;
  $('#otpCode').value = '';
  $('#otpMessage').textContent = '';
  modal.classList.remove('hidden');
  setTimeout(() => $('#otpCode').focus(), 50);
}

async function verifyOtp() {
  const code = $('#otpCode').value.trim();
  if (!/^\d{6}$/.test(code)) { $('#otpMessage').textContent = 'Escribe un código válido de 6 dígitos.'; return; }
  try {
    await callFunction('verify-otp', { email: state.pendingRegistration.email, code, purpose: state.pendingRegistration.purpose });
    closeModal('otpModal');
    if (['register', 'login'].includes(state.pendingRegistration.purpose)) {
      const { email, password } = state.pendingRegistration;
      state.awaitingOtp = false;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    showToast('Correo verificado correctamente.');
    state.pendingRegistration = null;
  } catch (error) { $('#otpMessage').textContent = error.message; }
}

async function loadProducts() {
  const { data, error } = await supabase.from('productos').select('*, paquetes(*)').eq('activo', true).order('orden');
  if (error) throw error;
  state.products = data || [];
  $('#productCount').textContent = `${state.products.length} disponibles`;
  $('#productsGrid').innerHTML = state.products.map(product => `<button class="product-card" data-product-id="${product.id}"><div class="product-cover">${product.logo_url ? `<img src="${escapeAttr(product.logo_url)}" alt="${escapeAttr(product.nombre)}">` : initials(product.nombre)}</div><div class="product-info"><h3>${escapeHtml(product.nombre)}</h3><p>${escapeHtml(product.descripcion || 'Recarga disponible en Niunx Play.')}</p><span class="product-action">Ver paquetes →</span></div></button>`).join('') || '<div class="empty-state">Aún no hay productos activos.</div>';
  $$('#productsGrid [data-product-id]').forEach(card => card.addEventListener('click', () => openProductDetail(card.dataset.productId)));
}

async function loadSiteConfiguration() {
  const { data, error } = await supabase.from('configuracion_sitio').select('img1,img2,img3,img4').order('id').limit(1).maybeSingle();
  if (error) throw error;
  state.banners = [data?.img1, data?.img2, data?.img3, data?.img4].filter(Boolean);
  renderCarousel();
}

function renderCarousel() {
  const slides = $('#carouselSlides');
  const dots = $('#carouselDots');
  if (!state.banners.length) { slides.innerHTML = '<div class="carousel-empty">Novedades de Niunx Play aparecerán aquí.</div>'; dots.innerHTML = ''; return; }
  state.carouselIndex = state.carouselIndex % state.banners.length;
  slides.innerHTML = state.banners.map((url, index) => `<img class="carousel-slide ${index === state.carouselIndex ? 'active' : ''}" src="${escapeAttr(url)}" alt="Destacado ${index + 1}">`).join('');
  dots.innerHTML = state.banners.map((_, index) => `<button class="carousel-dot ${index === state.carouselIndex ? 'active' : ''}" data-slide="${index}" aria-label="Ver destacado ${index + 1}"></button>`).join('');
  $$('#carouselDots [data-slide]').forEach(dot => dot.addEventListener('click', () => { state.carouselIndex = Number(dot.dataset.slide); renderCarousel(); }));
}

function moveCarousel(direction) { if (!state.banners.length) return; state.carouselIndex = (state.carouselIndex + direction + state.banners.length) % state.banners.length; renderCarousel(); }

function openProductDetail(productId) {
  const product = state.products.find(item => item.id === productId);
  if (!product) return;
  const packages = [...(product.paquetes || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0));
  $('#productDetail').innerHTML = `<div class="detail-banner" style="${product.banner_url ? `background-image:url('${escapeAttr(product.banner_url)}')` : ''}"><div class="detail-logo">${product.logo_url ? `<img src="${escapeAttr(product.logo_url)}" alt="">` : initials(product.nombre)}</div></div><p class="eyebrow">${escapeHtml(product.tipo_recarga || 'RECARGA')}</p><h2>${escapeHtml(product.nombre)}</h2><p class="helper product-description">${escapeHtml(product.descripcion || 'Elige tu paquete y disfruta tu recarga.')}</p>${product.require_id ? '<label class="player-id-label">ID del jugador<input id="playerIdInput" placeholder="Escribe el ID de tu cuenta" autocomplete="off"></label>' : ''}<div class="package-list">${packages.length ? packages.map(pack => `<button class="package-option" data-package-id="${pack.id}"><span><strong>${escapeHtml(pack.nombre_paquete)}</strong><small>${Number(pack.ncoins || 0).toFixed(2)} NCoins</small></span><span>→</span></button>`).join('') : '<div class="empty-state">Este producto aún no tiene paquetes.</div>'}</div>`;
  $$('#productDetail .package-option').forEach(option => option.addEventListener('click', () => { const needsId = product.require_id && !$('#playerIdInput')?.value.trim(); if (needsId) { $('#playerIdInput').focus(); showToast('Escribe el ID del jugador para continuar.', true); return; } showToast('Paquete seleccionado. La recarga estará disponible próximamente.'); }));
  openModal('productModal');
}

async function loadWallet() {
  const { data, error } = await supabase.from('saldos').select('saldo_ncoins').eq('user_id', state.user.id).maybeSingle();
  if (error && !error.message.includes('saldo_ncoins')) throw error;
  state.balance = Number(data?.saldo_ncoins || 0);
  $('#headerBalance').textContent = state.balance.toFixed(2);
  $('#heroBalance').textContent = state.balance.toFixed(2);
}

async function loadRate() {
  const { data, error } = await supabase.from('configuracion_sitio').select('tasa_dolar').order('id').limit(1).maybeSingle();
  if (error) throw error;
  state.rate = Number(data?.tasa_dolar || 0);
  $('#exchangeRate').textContent = state.rate ? `${state.rate.toFixed(2)} Bs / USD` : 'No disponible';
  updateAmount();
}

async function loadTransactions() {
  const { data, error } = await supabase.from('transactions').select('*').eq('google_id', state.user.id).order('created_at', { ascending: false }).limit(30);
  if (error) throw error;
  state.transactions = data || [];
  $('#transactionsList').innerHTML = state.transactions.length ? state.transactions.map(transaction => `<div class="transaction-row"><div><strong>#${escapeHtml(transaction.id_transaccion)}</strong><small>${formatDate(transaction.created_at)}</small></div><div>${escapeHtml(transaction.game || 'Recarga de wallet')}<small>${escapeHtml(transaction.paymentMethod || transaction.payment_method || 'Pago')}</small></div><div><strong>${Number(transaction.base_amount ?? transaction.finalPrice ?? 0).toFixed(2)} NCoins</strong><small>${escapeHtml(transaction.currency || '')}</small></div><div><span class="status ${statusClass(transaction.status)}">${statusLabel(transaction.status)}</span></div></div>`).join('') : '<div class="empty-state">Todavía no tienes transacciones.</div>';
  const latest = state.transactions[0];
  $('#recentSummary').textContent = latest ? `${statusLabel(latest.status)} · ${Number(latest.base_amount ?? latest.finalPrice ?? 0).toFixed(2)} NCoins` : 'Tus movimientos aparecerán aquí.';
}

function renderUser() {
  const metadata = state.user.user_metadata || {};
  const name = metadata.first_name || metadata.full_name?.split(' ')[0] || state.user.email?.split('@')[0] || 'amigo';
  $('#userName').textContent = name;
  $('#profileEmail').textContent = state.user.email || '';
  $('#profileName').value = `${metadata.first_name || ''} ${metadata.last_name || ''}`.trim();
  const initial = name.slice(0, 1).toUpperCase();
  $('#avatarInitial').textContent = initial;
  $('#profileAvatar').textContent = initial;
  if (metadata.avatar_url) { $('#avatarImage').src = metadata.avatar_url; $('#avatarImage').classList.remove('hidden'); $('#avatarInitial').classList.add('hidden'); }
}

async function enterApp(user) {
  state.user = user;
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  renderUser();
  try { await Promise.all([loadProducts(), loadSiteConfiguration(), loadWallet(), loadRate(), loadTransactions()]); } catch (error) { showToast(error.message, true); }
}

function updateAmount() {
  state.amount = Math.min(500, Math.max(1, Math.round(Number($('#amountSlider').value || $('#amountInput').value || 1) * 10) / 10));
  $('#amountSlider').value = state.amount;
  $('#amountInput').value = state.amount.toFixed(2);
  $('#amountValue').textContent = state.amount.toFixed(2);
  $('#amountCurrency').textContent = state.currency === 'usd' ? 'USD' : 'NCoins';
  $('#inputCurrency').textContent = state.currency === 'usd' ? 'USD' : 'NCoins';
  $('#vesConversion').classList.toggle('hidden', state.currency !== 'ves');
  $('#vesTotal').textContent = `${(state.amount * state.rate).toFixed(2)} Bs`;
}

function setCurrency(currency) {
  state.currency = currency;
  $$('.currency').forEach(button => button.classList.toggle('active', button.dataset.currency === currency));
  updateAmount();
}

async function submitProof() {
  const file = $('#proofFile').files[0];
  if (!file) return;
  const transactionId = `NX-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const path = `${state.user.id}/${transactionId}-${file.name.replace(/[^a-z0-9.]/gi, '-')}`;
  $('#submitProof').disabled = true;
  try {
    const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { data: publicData } = supabase.storage.from('payment-proofs').getPublicUrl(path);
    const currency = state.currency === 'usd' ? 'USD' : 'VES';
    const finalPrice = state.currency === 'usd' ? state.amount : state.amount * state.rate;
    const transaction = { id_transaccion: transactionId, finalPrice, base_amount: state.amount, currency, paymentMethod: 'Por definir', receipt_url: publicData.publicUrl, status: 'pendiente', google_id: state.user.id, email: state.user.email };
    const { data, error } = await supabase.from('transactions').insert(transaction).select('id').single();
    if (error) throw error;
      await callFunction('notify-transaction', { transactionId: data.id });
    closeModal('proofModal'); closeModal('topUpModal');
    showToast('Comprobante enviado. Te avisaremos por correo.');
    await loadTransactions();
  } catch (error) { showToast(error.message, true); } finally { $('#submitProof').disabled = false; }
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function escapeAttr(value) { return escapeHtml(value).replace(/javascript:/gi, ''); }
function initials(value) { return escapeHtml(String(value || 'NP').split(' ').map(word => word[0]).join('').slice(0, 3).toUpperCase()); }
function formatDate(value) { return new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium' }).format(new Date(value)); }
function statusClass(value) { return String(value || 'pendiente').toLowerCase().replace(/\s/g, ''); }
function statusLabel(value) { return ({ pendiente: 'En revisión', aprobado: 'Aprobado', rechazado: 'Rechazado', completado: 'Aprobado' }[String(value || '').toLowerCase()] || 'En revisión'); }

let gameFrame;
let gameRunning = false;
let gamePlayerY = 0;
let gameVelocity = 0;
let gameScore = 0;
let gameObstacleX = 100;

function startMiniGame() {
  const game = $('#miniGame');
  if (gameRunning) return;
  gameRunning = true; gameScore = 0; gamePlayerY = 0; gameVelocity = 0; gameObstacleX = 100;
  $('#startGame').classList.add('hidden');
  game.focus();
  const tick = () => {
    if (!gameRunning) return;
    gameVelocity -= 0.72; gamePlayerY += gameVelocity;
    if (gamePlayerY <= 0) { gamePlayerY = 0; gameVelocity = 0; }
    gameObstacleX -= 1.25;
    if (gameObstacleX < -8) { gameObstacleX = 100; gameScore += 10; }
    const player = $('.game-player');
    const obstacle = $('.game-obstacle') || document.createElement('div');
    if (!obstacle.classList.contains('game-obstacle')) { obstacle.className = 'game-obstacle'; game.append(obstacle); }
    player.style.bottom = `${18 + gamePlayerY}px`; obstacle.style.left = `${gameObstacleX}%`;
    $('.game-score').textContent = String(gameScore).padStart(4, '0');
    const playerRight = 18 + 9; const obstacleLeft = gameObstacleX;
    if (obstacleLeft < playerRight && obstacleLeft > 5 && gamePlayerY < 18) { gameRunning = false; $('#startGame').textContent = 'Reintentar →'; $('#startGame').classList.remove('hidden'); }
    if (gameRunning) gameFrame = requestAnimationFrame(tick);
  };
  gameFrame = requestAnimationFrame(tick);
}

function jumpMiniGame() { if (gameRunning && gamePlayerY === 0) gameVelocity = 11; }

$$('.switch').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.auth)));
$$('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
$$('[data-open]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); openModal(button.dataset.open); }));
$$('.currency').forEach(button => button.addEventListener('click', () => setCurrency(button.dataset.currency)));
$('[data-close="productModal"]')?.addEventListener('click', () => closeModal('productModal'));
$('#carouselPrev')?.addEventListener('click', () => moveCarousel(-1));
$('#carouselNext')?.addEventListener('click', () => moveCarousel(1));
$('#startGame')?.addEventListener('click', startMiniGame);
$('#miniGame')?.addEventListener('keydown', event => { if ([' ', 'ArrowUp'].includes(event.key)) { event.preventDefault(); jumpMiniGame(); } });
document.addEventListener('keydown', event => { if (event.key === ' ' && document.activeElement?.id !== 'otpCode') jumpMiniGame(); });
$$('.nav-link,[data-view]').forEach(button => button.addEventListener('click', () => { const view = button.dataset.view; if (!view) return; $$('.view').forEach(item => item.classList.toggle('active-view', item.id === view)); $$('.nav-link').forEach(item => item.classList.toggle('active', item.dataset.view === view)); }));
['openTopUp', 'openTopUpHero', 'openTopUpSmall', 'openTopUpCard'].forEach(id => $(`#${id}`)?.addEventListener('click', () => openModal('topUpModal')));
$('#amountSlider').addEventListener('input', updateAmount);
$('#amountInput').addEventListener('input', () => { $('#amountSlider').value = $('#amountInput').value; updateAmount(); });
$('#continuePayment').addEventListener('click', () => { $('#proofAmount').textContent = `${state.amount.toFixed(2)} NCoins`; openModal('proofModal'); });
$('#proofFile').addEventListener('change', event => { const file = event.target.files[0]; $('#fileName').textContent = file ? file.name : ''; $('#submitProof').disabled = !file; });
$('#dropzone').addEventListener('dragover', event => { event.preventDefault(); $('#dropzone').style.borderColor = 'var(--cyan)'; });
$('#dropzone').addEventListener('dragleave', () => { $('#dropzone').style.borderColor = ''; });
$('#dropzone').addEventListener('drop', event => { event.preventDefault(); $('#proofFile').files = event.dataTransfer.files; $('#proofFile').dispatchEvent(new Event('change')); });
$('#submitProof').addEventListener('click', submitProof);
$('#profileButton').addEventListener('click', () => openModal('profileModal'));
$('#logoutButton').addEventListener('click', async () => { await supabase.auth.signOut(); closeModal('profileModal'); $('#appView').classList.add('hidden'); $('#authView').classList.remove('hidden'); });
$('#profileForm').addEventListener('submit', async event => { event.preventDefault(); const name = $('#profileName').value.trim(); const password = $('#profilePassword').value; const [first_name, ...rest] = name.split(' '); const payload = { data: { first_name, last_name: rest.join(' ') } }; if (password) payload.password = password; const { error } = await supabase.auth.updateUser(payload); if (error) showToast(error.message, true); else { showToast('Perfil actualizado.'); closeModal('profileModal'); } });

$('#googleLogin').addEventListener('click', () => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }));
$('#googleRegister').addEventListener('click', () => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }));
$('#loginForm').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setAuthMessage('Comprobando tus datos...'); state.awaitingOtp = true; const { error } = await supabase.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') }); if (error) { state.awaitingOtp = false; setAuthMessage(error.message, true); return; } try { await callFunction('send-otp', { email: form.get('email'), purpose: 'login' }); state.pendingRegistration = { email: form.get('email'), password: form.get('password'), purpose: 'login' }; await supabase.auth.signOut(); openOtpModal(form.get('email'), 'login'); } catch (otpError) { state.awaitingOtp = false; setAuthMessage(otpError.message, true); await supabase.auth.signOut(); } });
$('#registerForm').addEventListener('submit', async event => { event.preventDefault(); const form = new FormData(event.currentTarget); if (form.get('password') !== form.get('passwordConfirm')) { setAuthMessage('Las contraseñas no coinciden.', true); return; } try { await callFunction('register-account', { email: form.get('email'), password: form.get('password'), firstName: form.get('firstName'), lastName: form.get('lastName') }); state.pendingRegistration = { email: form.get('email'), password: form.get('password'), purpose: 'register' }; openOtpModal(form.get('email'), 'register'); } catch (error) { setAuthMessage(error.message, true); } });

supabase.auth.onAuthStateChange(async (event, session) => { if (session?.user && !state.awaitingOtp && ['SIGNED_IN', 'INITIAL_SESSION'].includes(event)) await enterApp(session.user); });
const { data: { session } } = await supabase.auth.getSession();
if (session?.user) await enterApp(session.user);
//aaaa