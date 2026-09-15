import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authStorage, rememberSessionEnabled, setRememberSession } from './session.js';

const SUPABASE_URL = 'https://oznmqczxpywvdmefermv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96bm1xY3p4cHl3dmRtZWZlcm12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMyMDg3NzcsImV4cCI6MjA2ODc4NDc3N30.SxB0TpVWDihU6MZwQIG4fT42D9gvWjFQNga93zxRfbc';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storage: authStorage(), autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } });

const state = { user: null, balance: 0, currency: 'usd', rate: 0, amount: 10, paymentMethod: '', products: [], transactions: [], transactionsPage: 1, transactionsDate: '', banners: [], carouselIndex: 0, pendingRegistration: null, awaitingOtp: false };
// Capturar código de referido desde la URL (?ref=...) y almacenarlo en localStorage
(function captureReferralFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      localStorage.setItem('referral_code', ref);
      // Mensaje discreto para confirmar almacenamiento
      setTimeout(() => showToast('Código de referido guardado.'), 300);
    }
  } catch (e) { /* no bloquear si falla */ }
})();
let enteredUserId = null;
let enteringUserId = null;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const authLog = (message, details = {}) => console.info(`[Niunx Auth] ${message}`, details);
const userLog = user => ({ id: user?.id || null, emailDomain: user?.email?.split('@')[1] || null, provider: user?.app_metadata?.provider || null });

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

function setButtonLoading(button, loading, label = 'Procesando') {
  if (!button) return;
  if (loading) {
    button.dataset.originalLabel = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="loading-spinner" aria-hidden="true"></span>${label}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) button.innerHTML = button.dataset.originalLabel;
  }
}

async function callFunction(name, body) {
  authLog('Llamando función Netlify.', { name });
  const { data: { session } } = await supabase.auth.getSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const response = await fetch(`/.netlify/functions/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  authLog('Respuesta de función Netlify.', { name, status: response.status, ok: response.ok, error: data.error || null });
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

function passwordStrength(value) {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return score;
}

function updatePasswordStrength() {
  const input = $('#registerPassword');
  const bar = $('#passwordStrengthBar');
  const label = $('#passwordStrengthLabel');
  if (!input || !bar || !label) return;
  const score = passwordStrength(input.value);
  const levels = ['Escribe una contraseña', 'Nivel bajo', 'Nivel bajo', 'Nivel medio', 'Nivel alto', 'Nivel muy alto'];
  bar.style.width = `${score * 20}%`;
  bar.dataset.level = score < 3 ? 'low' : score < 5 ? 'medium' : 'high';
  label.textContent = levels[score];
}

function updateResetPasswordStrength() {
  const input = $('#resetPassword');
  const bar = $('#resetPasswordStrengthBar');
  const label = $('#resetPasswordStrengthLabel');
  if (!input || !bar || !label) return;
  const score = passwordStrength(input.value);
  const levels = ['Escribe una contraseña', 'Nivel bajo', 'Nivel bajo', 'Nivel medio', 'Nivel alto', 'Nivel muy alto'];
  bar.style.width = `${score * 20}%`;
  bar.dataset.level = score < 3 ? 'low' : score < 5 ? 'medium' : 'high';
  label.textContent = levels[score];
}

function openOtpModal(email, purpose) {
  state.pendingRegistration = { ...state.pendingRegistration, email, purpose };
  let modal = $('#otpModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'otpModal';
    modal.className = 'modal-backdrop';
    modal.innerHTML = `<section class="modal-card otp-card"><p class="eyebrow">VERIFICACIÓN</p><h2>Confirma que eres tú.</h2><p class="helper">Enviamos un código de 6 dígitos a <strong id="otpEmail"></strong>.</p><p class="otp-hint">¿No lo ves? Revisa también la carpeta de spam.</p><label class="otp-label">Código de seguridad<input id="otpCode" inputmode="numeric" maxlength="6" placeholder="000000"></label><p id="otpMessage" class="form-message"></p><button id="verifyOtp" class="button primary full">Verificar código <span>→</span></button><button id="resendOtp" class="button ghost full otp-resend">Enviar otro código</button></section>`;
    document.body.append(modal);
    $('#verifyOtp').addEventListener('click', verifyOtp);
    $('#resendOtp').addEventListener('click', async () => { setButtonLoading($('#resendOtp'), true, 'Enviando'); try { await callFunction('send-otp', { email: state.pendingRegistration.email, purpose: state.pendingRegistration.purpose }); $('#otpMessage').textContent = 'Código enviado nuevamente.'; } catch (error) { $('#otpMessage').textContent = error.message; } finally { setButtonLoading($('#resendOtp'), false); } });
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
  const pending = state.pendingRegistration;
  if (!pending) { $('#otpMessage').textContent = 'La verificación expiró. Solicita un código nuevo.'; return; }
  setButtonLoading($('#verifyOtp'), true, 'Verificando');
  $('#otpMessage').textContent = 'Verificando...';
  try {
    authLog('Validando código OTP.', { purpose: pending.purpose, emailDomain: pending.email.split('@')[1] || null });
    await callFunction('verify-otp', { email: pending.email, code, purpose: pending.purpose });
    authLog('Código OTP válido. Iniciando sesión.');
    const { data, error } = await supabase.auth.signInWithPassword({ email: pending.email, password: pending.password });
    if (error) {
      authLog('OTP válido, pero falló el inicio de sesión.', { message: error.message, code: error.code, status: error.status });
      throw error;
    }
    state.awaitingOtp = false;
    closeModal('otpModal');
    authLog('Inicio de sesión completado después del OTP.', userLog(data.user));
    await enterApp(data.user);
    showToast('Correo verificado correctamente.');
    state.pendingRegistration = null;
  } catch (error) {
    authLog('Falló la verificación OTP.', { message: error.message, code: error.code, status: error.status });
    $('#otpMessage').textContent = error.message;
  } finally { setButtonLoading($('#verifyOtp'), false); }
}

async function loadProducts() {
  authLog('Cargando productos.');
  const { data, error } = await supabase.from('productos').select('*, paquetes(*)').eq('activo', true).order('orden');
  if (error) { authLog('Error cargando productos.', { message: error.message, code: error.code, details: error.details }); throw error; }
  state.products = data || [];
  $('#productCount').textContent = `${state.products.length} disponibles`;
  $('#productsGrid').innerHTML = state.products.map(product => `<button class="product-card" data-product-id="${product.id}"><div class="product-cover">${product.logo_url ? `<img src="${escapeAttr(product.logo_url)}" alt="${escapeAttr(product.nombre)}">` : initials(product.nombre)}</div><div class="product-info"><h3>${escapeHtml(product.nombre)}</h3><p>${escapeHtml(product.descripcion || 'Recarga disponible en Niunx Play.')}</p><span class="product-action">Ver paquetes →</span></div></button>`).join('') || '<div class="empty-state">Aún no hay productos activos.</div>';
  $$('#productsGrid [data-product-id]').forEach(card => card.addEventListener('click', () => openProductDetail(card.dataset.productId)));
}

async function loadSiteConfiguration() {
  authLog('Cargando configuración del sitio.');
  const { data, error } = await supabase.from('configuracion_sitio').select('img1,img2,img3,img4').order('id').limit(1).maybeSingle();
  if (error) { authLog('Error cargando configuración.', { message: error.message, code: error.code, details: error.details }); throw error; }
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

function isFreeFireProduct(product) { return /free\s*fire/i.test(`${product.nombre || ''} ${product.slug || ''}`); }

function openProductDetail(productId) {
  const product = state.products.find(item => item.id === productId);
  if (!product) return;
  const packages = [...(product.paquetes || [])].sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const freeFire = isFreeFireProduct(product);
  const destinationField = product.require_id || freeFire ? '<label class="player-id-label">ID de cuenta<input id="playerIdInput" placeholder="Escribe la ID de la cuenta" autocomplete="off"></label>' : '<label class="player-id-label">WhatsApp de contacto<input id="playerIdInput" type="tel" placeholder="Ej. 0412 123 4545" autocomplete="tel"></label>';
  const manualOrder = !freeFire ? '<div id="manualOrder" class="free-fire-check hidden"><p id="manualOrderStatus" class="form-message"></p><button id="submitManualOrder" class="button primary full" type="button">Enviar pedido</button></div>' : '';
  $('#productDetail').innerHTML = `<div class="detail-banner" style="${product.banner_url ? `background-image:url('${escapeAttr(product.banner_url)}')` : ''}"><div class="detail-logo">${product.logo_url ? `<img src="${escapeAttr(product.logo_url)}" alt="">` : initials(product.nombre)}</div></div><h2>${escapeHtml(product.nombre)}</h2><p class="helper product-description">${escapeHtml(product.descripcion || 'Elige tu paquete y disfruta tu recarga.')}</p>${destinationField}<div class="package-list">${packages.length ? packages.map(pack => `<button class="package-option" data-package-id="${pack.id}"><span><strong>${escapeHtml(pack.nombre_paquete)}</strong><small>${Number(pack.ncoins || 0).toFixed(2)} NCoins</small></span><span>→</span></button>`).join('') : '<div class="empty-state">Este producto aún no tiene paquetes.</div>'}</div>${freeFire ? '<div id="freeFireCheck" class="free-fire-check hidden"><p id="freeFireStatus" class="form-message"></p><button id="validateFreeFire" class="button primary full" type="button">Validar cuenta</button><button id="confirmFreeFire" class="button primary full hidden" type="button">Confirmar compra</button></div>' : manualOrder}`;
  $$('#productDetail .package-option').forEach(option => option.addEventListener('click', () => {
    const selectedPackage = packages.find(pack => pack.id === option.dataset.packageId);
    $$('#productDetail .package-option').forEach(item => item.classList.remove('selected'));
    option.classList.add('selected');
    if (!freeFire) {
      $('#manualOrder').classList.remove('hidden');
      $('#manualOrder').dataset.packageId = selectedPackage?.id || '';
      $('#manualOrder').dataset.packageName = selectedPackage?.nombre_paquete || '';
      $('#manualOrderStatus').className = 'form-message';
      $('#manualOrderStatus').textContent = product.require_id ? 'Verifica la ID antes de enviar tu pedido.' : 'Verifica el WhatsApp antes de enviar tu pedido.';
      return;
    }
    $('#freeFireCheck').classList.remove('hidden');
    $('#freeFireCheck').dataset.packageName = selectedPackage?.nombre_paquete || '';
    $('#freeFireCheck').dataset.packageId = selectedPackage?.id || '';
    $('#freeFireCheck').dataset.productId = '';
    $('#freeFireCheck').dataset.validatedId = '';
    $('#freeFireCheck').dataset.validatedPackageName = '';
    $('#freeFireStatus').className = 'form-message';
    $('#freeFireStatus').textContent = 'Selecciona Validar cuenta antes de confirmar.';
    $('#confirmFreeFire').classList.add('hidden');
  }));
  if (freeFire) {
    $('#playerIdInput')?.addEventListener('input', () => {
      $('#freeFireCheck').dataset.validatedId = '';
      $('#freeFireCheck').dataset.validatedPackageName = '';
      $('#confirmFreeFire').classList.add('hidden');
      $('#freeFireStatus').className = 'form-message';
      $('#freeFireStatus').textContent = 'La cuenta cambió. Valídala nuevamente.';
    });
    $('#validateFreeFire').addEventListener('click', async () => {
      const serviceUserId = $('#playerIdInput')?.value.trim();
      const packageName = $('#freeFireCheck').dataset.packageName;
      if (!serviceUserId) { $('#playerIdInput').focus(); $('#freeFireStatus').textContent = 'Escribe el ID de cuenta primero.'; return; }
      if (!packageName) { $('#freeFireStatus').textContent = 'Selecciona un paquete primero.'; return; }
      setButtonLoading($('#validateFreeFire'), true, 'Validando cuenta');
      try {
        const result = await callFunction('validate-free-fire', { serviceUserId, packageName });
        if ($('#playerIdInput')?.value.trim() !== serviceUserId || $('#freeFireCheck').dataset.packageName !== packageName) return;
        if (!result.valid) { $('#freeFireStatus').className = 'form-message invalid-account'; $('#freeFireStatus').textContent = 'Cuenta no validada. Revisa el ID.'; $('#confirmFreeFire').classList.add('hidden'); return; }
        $('#freeFireStatus').className = 'form-message valid-account';
        $('#freeFireStatus').textContent = result.accountName ? `Cuenta válida: ${result.accountName}` : 'Cuenta válida.';
        $('#freeFireCheck').dataset.productId = result.productId;
        $('#freeFireCheck').dataset.validatedId = serviceUserId;
        $('#freeFireCheck').dataset.validatedPackageName = packageName;
        $('#confirmFreeFire').classList.remove('hidden');
      } catch (error) { $('#freeFireStatus').textContent = error.message; } finally { setButtonLoading($('#validateFreeFire'), false); }
    });
    $('#confirmFreeFire').addEventListener('click', async () => {
      const currentId = $('#playerIdInput')?.value.trim();
      const packageName = $('#freeFireCheck').dataset.packageName;
      const packageId = $('#freeFireCheck').dataset.packageId;
      if (currentId !== $('#freeFireCheck').dataset.validatedId || packageName !== $('#freeFireCheck').dataset.validatedPackageName) {
        $('#confirmFreeFire').classList.add('hidden');
        $('#freeFireStatus').className = 'form-message';
        $('#freeFireStatus').textContent = 'La cuenta cambió. Valídala nuevamente.';
        return;
      }
      const productId = $('#freeFireCheck').dataset.productId;
      if (!productId || !packageName || !packageId) {
        $('#confirmFreeFire').classList.add('hidden');
        $('#freeFireStatus').textContent = 'Selecciona y valida un paquete antes de comprar.';
        return;
      }
      setButtonLoading($('#confirmFreeFire'), true, 'Comprando');
      try {
        const referralCode = localStorage.getItem('referral_code') || null;
        const result = await callFunction('buy-free-fire', { serviceUserId: currentId, packageName, productId, packageId, referralCode });
        const transactionId = result.transaction?.transaction_id;
        $('#freeFireStatus').className = 'form-message valid-account';
        $('#freeFireStatus').textContent = transactionId ? `Recarga enviada. Orden #${transactionId}.` : 'Recarga enviada correctamente.';
        $('#confirmFreeFire').classList.add('hidden');
        showPurchaseSuccess(result.transaction, true);
        await Promise.all([loadWallet(), loadTransactions()]);
      } catch (error) {
        $('#freeFireStatus').className = 'form-message invalid-account';
        $('#freeFireStatus').textContent = error.message;
      } finally { setButtonLoading($('#confirmFreeFire'), false); }
    });
  } else {
    $('#playerIdInput')?.addEventListener('input', () => {
      $('#submitManualOrder').classList.remove('hidden');
      $('#manualOrderStatus').className = 'form-message';
      $('#manualOrderStatus').textContent = product.require_id ? 'La ID cambió. Revisa los datos antes de enviar.' : 'El WhatsApp cambió. Revisa los datos antes de enviar.';
    });
    $('#submitManualOrder').addEventListener('click', async () => {
      const destination = $('#playerIdInput')?.value.trim();
      const packageId = $('#manualOrder').dataset.packageId;
      const packageName = $('#manualOrder').dataset.packageName;
      if (!destination) { $('#playerIdInput').focus(); $('#manualOrderStatus').textContent = product.require_id ? 'Escribe la ID de cuenta primero.' : 'Escribe el WhatsApp primero.'; return; }
      if (!packageId || !packageName) { $('#manualOrderStatus').textContent = 'Selecciona un paquete primero.'; return; }
      setButtonLoading($('#submitManualOrder'), true, 'Enviando pedido');
      try {
        const result = await callFunction('create-manual-order', { productId: product.id, packageId, packageName, destination });
        $('#manualOrderStatus').className = 'form-message valid-account';
        $('#manualOrderStatus').textContent = 'Pedido enviado y saldo descontado. Revisa tu correo.';
        $('#submitManualOrder').classList.add('hidden');
        showPurchaseSuccess(result.transaction);
        await Promise.all([loadWallet(), loadTransactions()]);
      } catch (error) {
        $('#manualOrderStatus').className = 'form-message invalid-account';
        $('#manualOrderStatus').textContent = error.message;
      } finally { setButtonLoading($('#submitManualOrder'), false); }
    });
  }
  openModal('productModal');
}

async function loadWallet() {
  authLog('Cargando saldo.', { userId: state.user?.id });
  const { data, error } = await supabase.from('saldos').select('saldo_ncoins').eq('user_id', state.user.id).maybeSingle();
  if (error) { authLog('Error cargando saldo.', { message: error.message, code: error.code, details: error.details }); }
  if (error && !error.message.includes('saldo_ncoins')) throw error;
  state.balance = Number(data?.saldo_ncoins || 0);
  $('#headerBalance').textContent = state.balance.toFixed(2);
  $('#heroBalance').textContent = state.balance.toFixed(2);
}

async function loadRate() {
  authLog('Cargando tasa.');
  const { data, error } = await supabase.from('configuracion_sitio').select('tasa_dolar').order('id').limit(1).maybeSingle();
  if (error) { authLog('Error cargando tasa.', { message: error.message, code: error.code, details: error.details }); throw error; }
  state.rate = Number(data?.tasa_dolar || 0);
  $('#exchangeRate').textContent = state.rate ? `${state.rate.toFixed(2)} Bs / USD` : 'No disponible';
  updateAmount();
}

async function loadTransactions() {
  authLog('Cargando transacciones.', { userId: state.user?.id });
  const retentionStart = new Date();
  retentionStart.setMonth(retentionStart.getMonth() - 1);
  const { data, error } = await supabase.from('transactions').select('id,id_transaccion,"finalPrice",base_amount,currency,"paymentMethod",status,google_id,email,created_at,completed_at,completed_by,game,product_name,service_user_id,provider_status,amount_charged,details').eq('google_id', state.user.id).gte('created_at', retentionStart.toISOString()).order('created_at', { ascending: false }).limit(100);
  if (error) { authLog('Error cargando transacciones.', { message: error.message, code: error.code, details: error.details }); throw error; }
  state.transactions = data || [];
  ensureTransactionControls();
  state.transactionsPage = 1;
  renderTransactions();
  const latest = state.transactions[0];
  $('#recentSummary').textContent = latest ? `${statusLabel(latest.status)} · ${Number(latest.base_amount ?? latest.finalPrice ?? 0).toFixed(2)} NCoins` : 'Tus movimientos aparecerán aquí.';
}

function ensureTransactionControls() {
  const list = $('#transactionsList');
  if (!list) return;
  const tableCard = list.closest('.table-card');
  if (!$('#transactionDateFilter')) {
    const filters = document.createElement('div');
    filters.className = 'transaction-filters';
    filters.innerHTML = '<label>Buscar por fecha<input id="transactionDateFilter" type="date"></label><button id="clearTransactionDate" class="button ghost" type="button">Mostrar todas</button>';
    tableCard.parentElement.insertBefore(filters, tableCard);
    $('#transactionDateFilter').addEventListener('change', event => { state.transactionsDate = event.target.value; state.transactionsPage = 1; renderTransactions(); });
    $('#clearTransactionDate').addEventListener('click', () => { state.transactionsDate = ''; $('#transactionDateFilter').value = ''; state.transactionsPage = 1; renderTransactions(); });
  }
  if (!$('#transactionPagination')) {
    const pagination = document.createElement('div');
    pagination.id = 'transactionPagination';
    pagination.className = 'transaction-pagination';
    list.after(pagination);
  }
  const header = tableCard.querySelector('.table-head');
  if (header && header.children.length === 4) header.innerHTML = '<span>Transacción</span><span>Producto</span><span>Detalle</span><span>Monto</span><span>Estado</span>';
}

function renderTransactions() {
  const selectedDate = state.transactionsDate;
  const filtered = state.transactions.filter(transaction => !selectedDate || new Date(transaction.created_at).toISOString().slice(0, 10) === selectedDate);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  state.transactionsPage = Math.min(state.transactionsPage, pageCount);
  const start = (state.transactionsPage - 1) * pageSize;
  const page = filtered.slice(start, start + pageSize);
  $('#transactionsList').innerHTML = page.length ? page.map(transaction => `<div class="transaction-row"><div><strong>#${escapeHtml(transaction.id_transaccion)}</strong><small>${formatDate(transaction.created_at)}</small></div><div>${escapeHtml(transaction.game || transaction.product_name || 'Recarga de wallet')}</div><div>${escapeHtml(transaction.package_name || (transaction.game ? transaction.product_name : '') || transaction.details?.item || transaction.paymentMethod || transaction.payment_method || 'Pago')}<small>${escapeHtml(transaction.service_user_id ? `ID: ${transaction.service_user_id}` : transaction.paymentMethod || transaction.payment_method || 'Pago')}</small></div><div><strong>${Number(transaction.base_amount ?? transaction.finalPrice ?? 0).toFixed(2)} NCoins</strong><small>${escapeHtml(transaction.currency || '')}</small></div><div><span class="status ${statusClass(transaction.status)}">${statusLabel(transaction.status)}</span></div></div>`).join('') : '<div class="empty-state">No hay transacciones para esta fecha.</div>';
  $('#transactionPagination').innerHTML = pageCount > 1 ? Array.from({ length: pageCount }, (_, index) => `<button class="pagination-button ${state.transactionsPage === index + 1 ? 'active' : ''}" data-page="${index + 1}">${index + 1}</button>`).join('') : '';
  $$('#transactionPagination [data-page]').forEach(button => button.addEventListener('click', () => { state.transactionsPage = Number(button.dataset.page); renderTransactions(); }));
}

function showPurchaseSuccess(transaction, manualOrder = false) {
  if (!$('#purchaseSuccessModal')) {
    document.body.insertAdjacentHTML('beforeend', '<div id="purchaseSuccessModal" class="modal-backdrop"><section class="modal-card purchase-success-modal"><button class="modal-close" data-close="purchaseSuccessModal" aria-label="Cerrar">×</button><p id="purchaseSuccessEyebrow" class="eyebrow"></p><h2 id="purchaseSuccessTitle"></h2><p id="purchaseSuccessMessage" class="helper"></p><div class="purchase-success-id"><span>Transacción</span><strong id="purchaseSuccessId"></strong></div><button class="button primary full" data-close="purchaseSuccessModal" type="button">Continuar</button></section></div>');
    $$('#purchaseSuccessModal [data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
  }
  $('#purchaseSuccessEyebrow').textContent = manualOrder ? 'PEDIDO RECIBIDO' : 'RECARGA COMPLETADA';
  $('#purchaseSuccessTitle').textContent = manualOrder ? '¡Pedido enviado!' : '¡Compra exitosa!';
  $('#purchaseSuccessId').textContent = transaction?.local_transaction_id || 'Confirmada';
  $('#purchaseSuccessMessage').textContent = manualOrder ? 'Tu pedido está pendiente. Te avisaremos por correo cuando sea completado.' : transaction?.item ? `Se procesó ${transaction.item} correctamente.` : 'La recarga se procesó correctamente.';
  openModal('purchaseSuccessModal');
}

function renderUser() {
  const metadata = state.user.user_metadata || {};
  const name = metadata.first_name || metadata.full_name?.split(' ')[0] || state.user.email?.split('@')[0] || 'amigo';
  $('#userName').textContent = name;
  $('#profileEmail').textContent = state.user.email || '';
  const initial = name.slice(0, 1).toUpperCase();
  $('#avatarInitial').textContent = initial;
  $('#profileAvatar').textContent = initial;
  if (metadata.avatar_url) { $('#avatarImage').src = metadata.avatar_url; $('#avatarImage').classList.remove('hidden'); $('#avatarInitial').classList.add('hidden'); }
}

async function enterApp(user) {
  if (!user?.id) { authLog('No se puede entrar al panel: no hay usuario.'); return; }
  if (enteredUserId === user.id || enteringUserId === user.id) { authLog('Entrada duplicada ignorada.', userLog(user)); return; }
  enteringUserId = user.id;
  authLog('Sesión válida recibida; entrando al panel.', userLog(user));
  state.user = user;
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  buildSkyGame();
  renderUser();
  try {
    await Promise.all([loadProducts(), loadSiteConfiguration(), loadWallet(), loadRate(), loadTransactions()]);
    enteredUserId = user.id;
    try { createReferralUi(); } catch (e) { console.error('createReferralUi failed', e); }
    authLog('Panel cargado correctamente.', userLog(user));
  } catch (error) {
    authLog('La sesión existe, pero falló la carga inicial.', { ...userLog(user), message: error.message, code: error.code });
    showToast(error.message, true);
  } finally {
    enteringUserId = null;
  }
}

function updateAmount() {
  state.amount = Math.min(500, Math.max(1, Math.round(Number($('#amountSlider').value || $('#amountInput').value || 1) * 10) / 10));
  $('#amountSlider').value = state.amount;
  $('#amountInput').value = state.amount.toFixed(2);
  $('#amountValue').textContent = state.amount.toFixed(2);
  $('#amountCurrency').textContent = 'NCoins';
  $('#inputCurrency').textContent = state.currency === 'usd' ? 'USD' : 'NCoins';
  $('#vesConversion').classList.remove('hidden');
  const conversionRows = $('#vesConversion').querySelectorAll('span, strong');
  conversionRows[0].textContent = state.currency === 'usd' ? 'Cambio' : 'Tasa actual';
  conversionRows[1].textContent = state.currency === 'usd' ? '1 NCoin = 1 USD': `1 NCoin = ${state.rate.toFixed(2)} Bs`;
  conversionRows[2].textContent = state.currency === 'usd' ? 'Equivalencia' : 'Total en VES';
  conversionRows[3].textContent = state.currency === 'usd' ? `${state.amount.toFixed(2)} USD` : `${(state.amount * state.rate).toFixed(2)} Bs`;
}

function setCurrency(currency) {
  state.currency = currency;
  state.paymentMethod = '';
  $$('.currency').forEach(button => button.classList.toggle('active', button.dataset.currency === currency));
  renderPaymentMethods();
  updateAmount();
}

function paymentOptions() {
  if (state.currency === 'usd') return [
    { id: 'binance-pay', name: 'Binance Pay', details: ['ID: 909792776', 'Correo: endryreyes199@gmail.com'] },
    { id: 'usdt-bep20', name: 'USDT BEP20', details: ['Dirección: 0x9ebe5fe682123c531408944236a99754886a46dd'] },
    { id: 'zinli', name: 'Zinli', details: ['Correo: endryreyes199@gmail.com'] }
  ];
  return [
    { id: 'pago-movil', name: 'Pago móvil', details: ['Banco de Venezuela (0102)', 'Teléfono: 04127123391', 'Cédula: 31605458'] },
    { id: 'pago-ubi', name: 'Pago UBI', details: ['Correo: endryjosuereyessequera@gmail.com'] }
  ];
}

function renderPaymentMethods() {
  const container = $('#paymentMethods');
  if (!container) return;
  container.innerHTML = paymentOptions().map(option => `<button class="payment-method ${state.paymentMethod === option.id ? 'selected' : ''}" data-payment-method="${option.id}"><span class="payment-method-title"><strong>${escapeHtml(option.name)}</strong><span>${state.paymentMethod === option.id ? 'Seleccionado' : 'Seleccionar →'}</span></span><span class="payment-details">${option.details.map(detail => `<span>${escapeHtml(detail)}</span>`).join('')}</span></button>`).join('');
  $$('#paymentMethods [data-payment-method]').forEach(button => button.addEventListener('click', () => { state.paymentMethod = button.dataset.paymentMethod; renderPaymentMethods(); }));
}

async function submitProof() {
  const file = $('#proofFile').files[0];
  if (!file) return;
  const transactionId = `NX-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const path = `${state.user.id}/${transactionId}-${file.name.replace(/[^a-z0-9.]/gi, '-')}`;
  setButtonLoading($('#submitProof'), true, 'Enviando comprobante');
  try {
    const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { data: publicData } = supabase.storage.from('payment-proofs').getPublicUrl(path);
    const currency = state.currency === 'usd' ? 'USD' : 'VES';
    const finalPrice = state.currency === 'usd' ? state.amount : state.amount * state.rate;
    const transaction = { id_transaccion: transactionId, finalPrice, base_amount: state.amount, currency, paymentMethod: state.paymentMethod, receipt_url: publicData.publicUrl, status: 'pendiente', google_id: state.user.id, email: state.user.email };
    const { data, error } = await supabase.from('transactions').insert(transaction).select('id').single();
    if (error) throw error;
      await callFunction('notify-transaction', { transactionId: data.id });
    closeModal('proofModal'); closeModal('topUpModal');
    showToast('Comprobante enviado. Te avisaremos por correo.');
    await loadTransactions();
  } catch (error) { showToast(error.message, true); } finally { setButtonLoading($('#submitProof'), false); }
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function escapeAttr(value) { return escapeHtml(value).replace(/javascript:/gi, ''); }
function initials(value) { return escapeHtml(String(value || 'NP').split(' ').map(word => word[0]).join('').slice(0, 3).toUpperCase()); }
function formatDate(value) { return new Intl.DateTimeFormat('es-VE', { dateStyle: 'medium' }).format(new Date(value)); }
function statusClass(value) { return String(value || 'pendiente').toLowerCase().replace(/\s/g, ''); }
function statusLabel(value) { return ({ pendiente: 'En revisión', procesando: 'Procesando', aprobado: 'Aprobado', rechazado: 'Rechazado', completado: 'Completado' }[String(value || '').toLowerCase()] || 'En revisión'); }

let gameFrame;
let gameRunning = false;
let gameLevel = 1;
let gameLives = 3;
let gameScore = 0;
let gamePaddleX = 0;
let gameBall = { x: 0, y: 0, vx: 3.2, vy: -3.2, radius: 7 };
let gameBalls = [];
let gameBlocks = [];
const basePaddleWidth = 96;
let gamePaddleWidth = basePaddleWidth;
let gamePowerUps = [];
const gameKeys = { left: false, right: false };
let gameCountdown = false;
let gameCountdownTimer;

function buildSkyGame() {
  const game = $('#miniGame');
  game.classList.add('sky-climb');
  game.innerHTML = '<div class="game-hud"><span>NIVEL <strong id="gameLevel">1</strong></span><span>PUNTOS <strong id="gameScore">0000</strong></span><span>VIDAS <strong id="gameLives">♥♥♥</strong></span></div><div class="breakout-board"><div class="breakout-blocks"></div><div class="breakout-powerups"></div><div id="gameCountdown" class="game-countdown"></div><div class="breakout-ball"></div><div class="breakout-paddle"></div></div><button id="startGame" class="game-start">Jugar breakout <span>→</span></button><p class="game-tip">Mueve la barra con el dedo o las flechas</p>';
  $('#startGame').addEventListener('click', startMiniGame);
  gameLevel = 1; gameLives = 3; gameScore = 0;
  resetBreakoutLevel();
}

function resetBreakoutLevel() {
  const board = $('.breakout-board');
  if (!board) return;
  const columns = 12;
  const rows = Math.min(6 + Math.floor(gameLevel / 2), 9);
  gameBlocks = [];
  gamePowerUps = [];
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const edgeGap = row > 1 && (column === 0 || column === columns - 1) && Math.random() < .35;
    if (edgeGap || Math.random() < .05) continue;
    const roll = Math.random();
    const type = row === 0 && column % 4 === 0 ? 'solid' : roll < .16 ? 'hard' : 'normal';
    const shape = row % 2 === 0 ? 'brick' : 'brick-soft';
    gameBlocks.push({ row, column, type, shape, hits: type === 'hard' ? 2 : type === 'solid' ? Infinity : 1, alive: true });
  }
  gamePaddleWidth = basePaddleWidth;
  gamePaddleX = Math.max(0, (board.clientWidth - gamePaddleWidth) / 2);
  const speed = gameLevel === 1 ? 2.35 : 3.2 + ((gameLevel - 1) * .25);
  gameBall = { x: board.clientWidth / 2, y: board.clientHeight - 55, vx: gameLevel % 2 ? speed : -speed, vy: -(gameLevel === 1 ? 2 : speed), radius: 7 };
  gameBalls = [gameBall];
  renderBreakout();
}

function beginRoundCountdown() {
  clearInterval(gameCountdownTimer);
  const countdown = $('#gameCountdown');
  if (!countdown) return;
  gameCountdown = true;
  let count = 3;
  countdown.textContent = count;
  countdown.classList.add('visible');
  gameCountdownTimer = setInterval(() => {
    count -= 1;
    if (count > 0) {
      countdown.textContent = count;
      return;
    }
    clearInterval(gameCountdownTimer);
    countdown.textContent = '¡YA!';
    gameCountdown = false;
    gameBalls.forEach(ball => { ball.vy = -Math.abs(gameLevel === 1 ? 2 : 2.4 + ((gameLevel - 1) * .2)); });
    setTimeout(() => countdown.classList.remove('visible'), 350);
  }, 700);
}

function renderBreakout() {
  const blocks = $('.breakout-blocks');
  const board = $('.breakout-board');
  if (!blocks || !board) return;
  const gap = 4; const blockWidth = (board.clientWidth - gap * 13) / 12; const blockHeight = 12;
  blocks.innerHTML = gameBlocks.map((block, index) => `<span class="breakout-block ${block.alive ? '' : 'broken'} block-${block.type} shape-${block.shape} level-${(block.row + gameLevel) % 4}" data-block="${index}" style="left:${gap + block.column * (blockWidth + gap)}px;top:${18 + block.row * (blockHeight + gap)}px;width:${blockWidth}px;height:${blockHeight}px"><b>${block.type === 'hard' ? block.hits : block.type === 'solid' ? '◆' : ''}</b></span>`).join('');
  const ball = $('.breakout-ball'); const paddle = $('.breakout-paddle');
  const primaryBall = gameBalls[0] || gameBall;
  ball.style.left = `${primaryBall.x - primaryBall.radius}px`; ball.style.top = `${primaryBall.y - primaryBall.radius}px`;
  document.querySelectorAll('.extra-ball').forEach(item => item.remove());
  gameBalls.slice(1).forEach(extra => { const extraElement = document.createElement('span'); extraElement.className = 'breakout-ball extra-ball'; extraElement.style.left = `${extra.x - extra.radius}px`; extraElement.style.top = `${extra.y - extra.radius}px`; board.append(extraElement); });
  paddle.style.left = `${gamePaddleX}px`;
  paddle.style.width = `${gamePaddleWidth}px`;
  const powerLayer = $('.breakout-powerups');
  if (powerLayer) powerLayer.innerHTML = gamePowerUps.map((power, index) => `<span class="breakout-powerup power-${power.type}" data-power="${index}" style="left:${power.x}px;top:${power.y}px">${power.type === 'expand' ? '↔' : power.type === 'multi' ? '●●' : '♥'}</span>`).join('');
  $('#gameLevel').textContent = gameLevel; $('#gameScore').textContent = String(gameScore).padStart(4, '0'); $('#gameLives').textContent = `${'♥'.repeat(Math.min(gameLives, 3))}${'♡'.repeat(Math.max(0, 3 - gameLives))}`;
}

function startMiniGame() {
  if (gameRunning) return;
  if (!$('.breakout-board')) buildSkyGame();
  gameLevel = 1;
  gameLives = 3;
  gameScore = 0;
  resetBreakoutLevel(); gameRunning = true; $('#startGame').classList.add('hidden'); $('#miniGame').focus(); beginRoundCountdown(); gameFrame = requestAnimationFrame(runBreakout);
}

function loseBreakoutLife() {
  gameLives -= 1;
  if (gameLives <= 0) { gameRunning = false; $('#startGame').textContent = 'Reintentar partida →'; $('#startGame').classList.remove('hidden'); }
  else { resetBreakoutLevel(); beginRoundCountdown(); }
}

function runBreakout() {
  if (!gameRunning) return;
  const board = $('.breakout-board');
  const paddleWidth = gamePaddleWidth; const paddleHeight = 10;
  if (gameKeys.left) gamePaddleX -= 5.5;
  if (gameKeys.right) gamePaddleX += 5.5;
  gamePaddleX = Math.max(0, Math.min(board.clientWidth - paddleWidth, gamePaddleX));
  if (gameCountdown) { renderBreakout(); if (gameRunning) gameFrame = requestAnimationFrame(runBreakout); return; }
  const paddleY = board.clientHeight - 22;
  const gap = 4; const blockWidth = (board.clientWidth - gap * 13) / 12; const blockHeight = 12;
  gameBalls.forEach(ball => {
    ball.x += ball.vx; ball.y += ball.vy;
    if (ball.x - ball.radius <= 0 || ball.x + ball.radius >= board.clientWidth) { ball.vx *= -1; ball.x = Math.max(ball.radius, Math.min(board.clientWidth - ball.radius, ball.x)); }
    if (ball.y - ball.radius <= 0) { ball.y = ball.radius; ball.vy = Math.abs(ball.vy); }
    if (ball.vy > 0 && ball.y + ball.radius >= paddleY && ball.y - ball.radius <= paddleY + paddleHeight && ball.x >= gamePaddleX && ball.x <= gamePaddleX + paddleWidth) {
      const hit = (ball.x - (gamePaddleX + paddleWidth / 2)) / (paddleWidth / 2); ball.vx = hit * 4.5; ball.vy = -Math.abs(ball.vy);
    }
    gameBlocks.forEach(block => {
      if (!block.alive) return;
      const x = gap + block.column * (blockWidth + gap); const y = 18 + block.row * (blockHeight + gap);
      if (ball.x + ball.radius > x && ball.x - ball.radius < x + blockWidth && ball.y + ball.radius > y && ball.y - ball.radius < y + blockHeight) {
        ball.vy *= -1;
        if (block.type === 'solid') return;
        block.hits -= 1;
        if (block.hits <= 0) { block.alive = false; gameScore += 10 * gameLevel; if (Math.random() < .28) gamePowerUps.push({ x: x + blockWidth / 2 - 9, y, type: ['expand', 'multi', 'life'][Math.floor(Math.random() * 3)] }); }
      }
    });
  });
  gamePowerUps.forEach(power => { power.y += 1.8; });
  gamePowerUps = gamePowerUps.filter(power => {
    const caught = power.y + 18 >= paddleY && power.y <= paddleY + 12 && power.x + 18 >= gamePaddleX && power.x <= gamePaddleX + paddleWidth;
    if (caught) { if (power.type === 'expand') gamePaddleWidth = Math.min(150, gamePaddleWidth + 28); if (power.type === 'life' && gameLives < 3) gameLives += 1; if (power.type === 'multi' && gameBalls.length < 3) gameBalls.push({ ...gameBalls[0], vx: -gameBalls[0].vx, vy: gameBalls[0].vy }); return false; }
    return power.y < board.clientHeight;
  });
  gameBalls = gameBalls.filter(ball => ball.y - ball.radius <= board.clientHeight);
  if (!gameBalls.length) loseBreakoutLife();
  if (!gameBlocks.some(block => block.alive && block.type !== 'solid')) { gameLevel += 1; gameScore += 100; resetBreakoutLevel(); }
  renderBreakout();
  if (gameRunning) gameFrame = requestAnimationFrame(runBreakout);
}

function moveBreakoutPaddle(clientX) { const board = $('.breakout-board'); if (!board) return; const rect = board.getBoundingClientRect(); gamePaddleX = Math.max(0, Math.min(board.clientWidth - gamePaddleWidth, clientX - rect.left - gamePaddleWidth / 2)); }
function jumpMiniGame() { if (gameRunning) gameBalls.forEach(ball => { ball.vy = -Math.abs(ball.vy); }); }

$$('.switch').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.auth)));
$('#rememberSession').checked = rememberSessionEnabled();
$('#rememberSession').addEventListener('change', event => setRememberSession(event.target.checked));
$('#registerPassword').addEventListener('input', updatePasswordStrength);
$('#resetPassword').addEventListener('input', updateResetPasswordStrength);
$('#forgotPassword').addEventListener('click', () => { $('#resetMessage').textContent = ''; openModal('resetModal'); $('#resetEmail').focus(); });
$('#profileChangePassword').addEventListener('click', () => { closeModal('profileModal'); $('#resetMessage').textContent = ''; $('#resetEmail').value = state.user?.email || ''; openModal('resetModal'); $('#sendResetCode').focus(); });
$('#sendResetCode').addEventListener('click', async () => {
  const email = $('#resetEmail').value.trim();
  if (!email) { $('#resetMessage').textContent = 'Escribe tu correo primero.'; return; }
  setButtonLoading($('#sendResetCode'), true, 'Enviando código');
  try { await callFunction('send-otp', { email, purpose: 'reset' }); $('#resetMessage').textContent = 'Código enviado. Revisa también la carpeta de spam.'; } catch (error) { $('#resetMessage').textContent = error.message; } finally { setButtonLoading($('#sendResetCode'), false); }
});
$('#resetForm').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('#resetPassword').value !== $('#resetPasswordConfirm').value) { $('#resetMessage').textContent = 'Las contraseñas no coinciden.'; return; }
  const button = event.currentTarget.querySelector('button[type="submit"]');
  setButtonLoading(button, true, 'Actualizando contraseña');
  try { await callFunction('reset-password', { email: $('#resetEmail').value.trim(), code: $('#resetCode').value.trim(), password: $('#resetPassword').value }); closeModal('resetModal'); showToast('Contraseña actualizada. Ya puedes iniciar sesión.'); } catch (error) { $('#resetMessage').textContent = error.message; } finally { setButtonLoading(button, false); }
});
buildSkyGame();
$$('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
$$('[data-open]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); openModal(button.dataset.open); }));
$$('.currency').forEach(button => button.addEventListener('click', () => setCurrency(button.dataset.currency)));
renderPaymentMethods();
$('[data-close="productModal"]')?.addEventListener('click', () => closeModal('productModal'));
$('#carouselPrev')?.addEventListener('click', () => moveCarousel(-1));
$('#carouselNext')?.addEventListener('click', () => moveCarousel(1));
$('#miniGame')?.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', ' '].includes(event.key)) event.preventDefault(); if (event.key === 'ArrowLeft') gameKeys.left = true; if (event.key === 'ArrowRight') gameKeys.right = true; if (event.key === ' ') jumpMiniGame(); });
$('#miniGame')?.addEventListener('keyup', event => { if (event.key === 'ArrowLeft') gameKeys.left = false; if (event.key === 'ArrowRight') gameKeys.right = false; });
document.addEventListener('keydown', event => { if (!$('#miniGame')?.matches(':focus')) return; if (event.key === 'ArrowLeft') gameKeys.left = true; if (event.key === 'ArrowRight') gameKeys.right = true; });
document.addEventListener('keyup', event => { if (event.key === 'ArrowLeft') gameKeys.left = false; if (event.key === 'ArrowRight') gameKeys.right = false; });
$('#miniGame')?.addEventListener('pointermove', event => { if (event.pointerType === 'touch' || event.pointerType === 'pen') moveBreakoutPaddle(event.clientX); });
$('#miniGame')?.addEventListener('pointerdown', event => { if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return; moveBreakoutPaddle(event.clientX); if (!gameRunning) startMiniGame(); });
document.addEventListener('keydown', event => { if (event.key === ' ' && document.activeElement?.id !== 'otpCode') jumpMiniGame(); });
$$('.nav-link,[data-view]').forEach(button => button.addEventListener('click', () => { const view = button.dataset.view; if (!view) return; $$('.view').forEach(item => item.classList.toggle('active-view', item.id === view)); $$('.nav-link').forEach(item => item.classList.toggle('active', item.dataset.view === view)); }));
['openTopUp', 'openTopUpHero', 'openTopUpSmall', 'openTopUpCard'].forEach(id => $(`#${id}`)?.addEventListener('click', () => openModal('topUpModal')));
$('#amountSlider').addEventListener('input', updateAmount);
$('#amountInput').addEventListener('input', () => { $('#amountSlider').value = $('#amountInput').value; updateAmount(); });
$('#continuePayment').addEventListener('click', () => { if (!state.paymentMethod) { showToast('Selecciona un método de pago para continuar.', true); return; } $('#proofAmount').textContent = `${state.amount.toFixed(2)} NCoins`; openModal('proofModal'); });
$('#proofFile').addEventListener('change', event => {
  const file = event.target.files[0];
  const dropzone = $('#dropzone');
  const fileName = $('#fileName');
  const submitButton = $('#submitProof');
  if (!file) {
    fileName.textContent = '';
    dropzone.querySelector('.proof-preview')?.remove();
    dropzone.classList.remove('has-file');
    dropzone.querySelector('strong').textContent = 'Arrastra tu captura aquí';
    dropzone.querySelector('small').textContent = 'o toca para buscar · JPG, PNG o WEBP';
    submitButton.disabled = true;
    return;
  }
  dropzone.classList.add('has-file');
  dropzone.querySelector('strong').textContent = 'Comprobante listo';
  dropzone.querySelector('small').textContent = `${file.type || 'Archivo'} · ${(file.size / 1024).toFixed(1)} KB`;
  fileName.textContent = file.name;
  dropzone.querySelector('.proof-preview')?.remove();
  if (file.type.startsWith('image/')) {
    const preview = document.createElement('img');
    preview.className = 'proof-preview';
    preview.alt = 'Vista previa del comprobante';
    preview.src = URL.createObjectURL(file);
    dropzone.append(preview);
  }
  submitButton.disabled = false;
});
$('#dropzone').addEventListener('dragover', event => { event.preventDefault(); $('#dropzone').style.borderColor = 'var(--cyan)'; });
$('#dropzone').addEventListener('dragleave', () => { $('#dropzone').style.borderColor = ''; });
$('#dropzone').addEventListener('click', event => { if (event.target !== $('#proofFile')) $('#proofFile').click(); });
$('#dropzone').addEventListener('drop', event => { event.preventDefault(); $('#proofFile').files = event.dataTransfer.files; $('#proofFile').dispatchEvent(new Event('change')); });
$('#submitProof').addEventListener('click', submitProof);
$('#profileButton').addEventListener('click', () => openModal('profileModal'));
$('#logoutButton').addEventListener('click', async () => {
  try { await supabase.auth.signOut(); } catch (e) { console.error('logout failed', e); }
  enteredUserId = null;
  closeModal('profileModal');
  $('#appView').classList.add('hidden');
  $('#authView').classList.remove('hidden');
  removeReferralUi();
});

async function startGoogleAuth(source) {
  authLog('Iniciando OAuth con Google.', { source, origin: window.location.origin });
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  if (error) authLog('Google rechazó el inicio OAuth.', { message: error.message, code: error.code, status: error.status });
}

$('#googleLogin').addEventListener('click', () => startGoogleAuth('login'));
$('#googleRegister').addEventListener('click', () => startGoogleAuth('register'));
$('#loginForm').addEventListener('submit', async event => { event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); setButtonLoading(button, true, 'Comprobando'); setRememberSession($('#rememberSession').checked); const form = new FormData(event.currentTarget); setAuthMessage('Comprobando tus datos...'); state.awaitingOtp = true; const { error } = await supabase.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') }); if (error) { state.awaitingOtp = false; setAuthMessage(error.message, true); setButtonLoading(button, false); return; } try { await callFunction('send-otp', { email: form.get('email'), purpose: 'login' }); state.pendingRegistration = { email: form.get('email'), password: form.get('password'), purpose: 'login' }; await supabase.auth.signOut(); openOtpModal(form.get('email'), 'login'); } catch (otpError) { state.awaitingOtp = false; setAuthMessage(otpError.message, true); await supabase.auth.signOut(); } finally { setButtonLoading(button, false); } });
$('#registerForm').addEventListener('submit', async event => { event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); const form = new FormData(event.currentTarget); if (form.get('password') !== form.get('passwordConfirm')) { setAuthMessage('Las contraseñas no coinciden.', true); return; } setButtonLoading(button, true, 'Creando cuenta'); try { await callFunction('register-account', { email: form.get('email'), password: form.get('password'), firstName: form.get('firstName'), lastName: form.get('lastName') }); state.pendingRegistration = { email: form.get('email'), password: form.get('password'), purpose: 'register' }; openOtpModal(form.get('email'), 'register'); } catch (error) { setAuthMessage(error.message, true); } finally { setButtonLoading(button, false); } });

supabase.auth.onAuthStateChange((event, session) => {
  authLog('Cambio de estado Auth.', { event, hasSession: Boolean(session), user: userLog(session?.user) });
  if (session?.user && !state.awaitingOtp && ['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED'].includes(event)) setTimeout(() => enterApp(session.user), 0);
});
const callbackParams = new URLSearchParams(window.location.search);
const callbackError = callbackParams.get('error') || callbackParams.get('error_code');
if (callbackError) authLog('Supabase devolvió un error OAuth en la URL.', { error: callbackError, description: callbackParams.get('error_description') });
const { data: { session } } = await supabase.auth.getSession();
authLog('Sesión recuperada al cargar la página.', { hasSession: Boolean(session), user: userLog(session?.user) });
if (session?.user) await enterApp(session.user);

//aaaaa

// Crear interfaz de colaborador (no la inserta hasta que el usuario esté autenticado)
function createReferralUi() {
  try {
    const anchor = document.createElement('a');
    anchor.id = 'becomeCollaborator';
    anchor.href = '#';
    anchor.title = 'Conviértete en colaborador';
    anchor.style.position = 'fixed';
    anchor.style.right = '12px';
    anchor.style.bottom = '12px';
    anchor.style.fontSize = '12px';
    anchor.style.color = 'var(--muted)';
    anchor.style.zIndex = '9999';
    anchor.textContent = 'Conviértete en colaborador';
    // Añadir en el footer si existe, sino al body
    const footer = document.querySelector('footer') || document.getElementById('footer');
    if (footer) footer.appendChild(anchor); else document.body.appendChild(anchor);

    anchor.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const result = await callFunction('referral-code', { action: 'get' });
        const code = result.code;
        const link = result.link || `${window.location.origin}?ref=${encodeURIComponent(code)}`;
        let modal = document.querySelector('#referralModal');
        if (!modal) {
          modal = document.createElement('div');
          modal.id = 'referralModal';
          modal.className = 'modal-backdrop hidden';
          modal.innerHTML = `<section class="modal-card"><p class="eyebrow">COLABORADOR</p><h2>Tu enlace de referido</h2><p class="helper">Comparte este enlace con tus clientes para obtener 40% de tus ganancias en Free Fire.</p><label class="form-label">Enlace<input id="referralLink" readonly></label><label class="form-label">Código<input id="referralCodeInput" readonly></label><p id="referralMessage" class="form-message"></p><div style="display:flex;gap:8px;margin-bottom:10px"><button id="copyReferral" class="button primary">Copiar enlace</button><button id="rotateReferral" class="button ghost">Rotar código</button><button id="closeReferral" class="button ghost">Cerrar</button></div><div id="referralEarningsContainer" style="max-height:360px;overflow:auto;margin-top:8px"></div></section>`;
          document.body.appendChild(modal);
          document.getElementById('closeReferral').addEventListener('click', () => modal.classList.add('hidden'));
          document.getElementById('copyReferral').addEventListener('click', async () => {
            const linkInput = document.getElementById('referralLink');
            try { await navigator.clipboard.writeText(linkInput.value); document.getElementById('referralMessage').textContent = 'Enlace copiado.'; } catch (err) { document.getElementById('referralMessage').textContent = 'No se pudo copiar. Copia manualmente.'; }
          });
          document.getElementById('rotateReferral').addEventListener('click', async () => {
            try {
              const res = await callFunction('referral-code', { action: 'rotate' });
              const newCode = res.code;
              const newLink = res.link || `${window.location.origin}?ref=${encodeURIComponent(newCode)}`;
              document.getElementById('referralLink').value = newLink;
              document.getElementById('referralCodeInput').value = newCode;
              document.getElementById('referralMessage').textContent = 'Código rotado correctamente.';
            } catch (err) {
              document.getElementById('referralMessage').textContent = err.message || 'No se pudo rotar el código.';
            }
          });
          // Controles para cargar historial de referidos
          async function loadReferralEarnings() {
            const container = document.getElementById('referralEarningsContainer');
            container.innerHTML = '<p class="helper">Cargando historial...</p>';
            try {
              const res = await callFunction('referral-code', { action: 'earnings' });
              const total = res.total || 0;
              const earnings = res.earnings || [];
              const rows = earnings.map(e => {
                const name = e.referred?.nombre || e.referred?.email || e.referred_user_id || 'Anónimo';
                const date = new Date(e.created_at).toLocaleString();
                return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(e.transaction_id || '')}</td><td>${Number(e.profit).toFixed(2)}</td><td>${Number(e.credited_amount).toFixed(2)}</td><td>${date}</td></tr>`;
              }).join('');
              container.innerHTML = `<div style="margin-bottom:8px"><strong>Total acreditado:</strong> ${Number(total).toFixed(2)} NCoins</div><table class="table"><thead><tr><th>Cliente</th><th>Transacción</th><th>Profit</th><th>Acreditado</th><th>Fecha</th></tr></thead><tbody>${rows}</tbody></table>`;
            } catch (err) {
              container.innerHTML = `<p class="form-message invalid-account">${err.message || 'No se pudo cargar el historial.'}</p>`;
            }
          }
        }
        document.getElementById('referralLink').value = link;
        document.getElementById('referralCodeInput').value = code;
        // Cargar historial inmediatamente
        try { loadReferralEarnings(); } catch (e) { /* ignore */ }
        modal.classList.remove('hidden');
      } catch (err) {
        showToast(err.message || 'No se pudo recuperar el código de referido.', true);
      }
    });
  } catch (e) { console.error('referral UI init failed', e); }
}

function removeReferralUi() {
  try {
    const anchor = document.getElementById('becomeCollaborator');
    if (anchor) anchor.remove();
    const modal = document.getElementById('referralModal');
    if (modal) modal.remove();
  } catch (e) { console.error('removeReferralUi failed', e); }
}
