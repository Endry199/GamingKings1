import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authStorage, rememberSessionEnabled, setRememberSession } from './session.js';

const SUPABASE_URL = 'https://oznmqczxpywvdmefermv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96bm1xY3p4cHl3dmRtZWZlcm12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMyMDg3NzcsImV4cCI6MjA2ODc4NDc3N30.SxB0TpVWDihU6MZwQIG4fT42D9gvWjFQNga93zxRfbc';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storage: authStorage(), autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } });

const state = { user: null, balance: 0, currency: 'usd', rate: 0, amount: 10, paymentMethod: '', products: [], transactions: [], transactionsPage: 1, transactionsDate: '', banners: [], carouselIndex: 0, pendingRegistration: null, awaitingOtp: false };

(function captureReferralFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        const ref = params.get('ref');
        if (ref) {
            localStorage.setItem('referral_code', ref);
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

let carouselTimer = null;

function renderCarousel() {
    const slides = $('#carouselSlides');
    const dots = $('#carouselDots');
    if (!state.banners.length) {
        slides.innerHTML = '<div class="carousel-empty">Novedades de Niunx Play aparecerán aquí.</div>';
        dots.innerHTML = '';
        stopCarouselAutoplay();
        return;
    }
    state.carouselIndex = state.carouselIndex % state.banners.length;
    slides.innerHTML = state.banners.map((url, index) => `<img class="carousel-slide ${index === state.carouselIndex ? 'active' : ''}" src="${escapeAttr(url)}" alt="Destacado ${index + 1}">`).join('');
    dots.innerHTML = state.banners.map((_, index) => `<button class="carousel-dot ${index === state.carouselIndex ? 'active' : ''}" data-slide="${index}" aria-label="Ver destacado ${index + 1}"></button>`).join('');
    $$('#carouselDots [data-slide]').forEach(dot => dot.addEventListener('click', () => {
        state.carouselIndex = Number(dot.dataset.slide);
        renderCarousel();
        restartCarouselAutoplay();
    }));
    startCarouselAutoplay();
}

function startCarouselAutoplay() {
    stopCarouselAutoplay();
    if (state.banners.length < 2) return;
    carouselTimer = setInterval(() => {
        moveCarousel(1);
    }, 5000);
}

function stopCarouselAutoplay() {
    if (carouselTimer) {
        clearInterval(carouselTimer);
        carouselTimer = null;
    }
}

function restartCarouselAutoplay() {
    stopCarouselAutoplay();
    startCarouselAutoplay();
}

function moveCarousel(direction) {
    if (!state.banners.length) return;
    state.carouselIndex = (state.carouselIndex + direction + state.banners.length) % state.banners.length;
    renderCarousel();
}

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
    state.amount = Math.min(50, Math.max(1, Math.round(Number($('#amountSlider').value || 1) * 10) / 10));
    $('#amountSlider').value = state.amount;
    $('#amountValue').textContent = state.amount.toFixed(2);
    $('#amountCurrency').textContent = 'NCoins';
    $('#vesConversion').classList.remove('hidden');
    const conversionRows = $('#vesConversion').querySelectorAll('span, strong');
    conversionRows[0].textContent = state.currency === 'usd' ? 'Cambio' : 'Tasa actual';
    conversionRows[1].textContent = state.currency === 'usd' ? '1 NCoin = 1 USD' : `1 NCoin = ${state.rate.toFixed(2)} Bs`;
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

/* =================================================================
   🎮 MINIJUEGO ARKANOID NEO — Sistema completo
   ================================================================= */

const GAME = {
    canvas: null,
    ctx: null,
    running: false,
    rafId: null,
    lastTime: 0,
    accumulator: 0,
    fixedStep: 1000 / 120,
    width: 0,
    height: 0,
    dpr: 1,
    level: 1,
    lives: 3,
    score: 0,
    combo: 0,
    comboTimer: 0,
    paddle: { x: 0, y: 0, w: 100, h: 14, targetX: 0 },
    basePaddleW: 100,
    expandTimer: 0,
    balls: [],
    blocks: [],
    powerups: [],
    particles: [],
    shake: { x: 0, y: 0, intensity: 0, duration: 0 },
    input: { left: false, right: false, pointerActive: false },
    // 🆕 Layout reajustado: topOffset reducido de 90 a 45 para el nuevo alto
    layout: { gap: 5, cols: 10, topOffset: 45, sideMargin: 12 },
    countdown: 0,
    winTransition: false,
    timers: new Set(),
    colors: {
        cyan: '#2be3ff',
        violet: '#a56bff',
        pink: '#f45bd8',
        green: '#42e4b3',
        orange: '#ffad62',
        danger: '#ff6d8c'
    }
};

function gameSetTimeout(fn, ms) {
    const id = setTimeout(() => { GAME.timers.delete(id); fn(); }, ms);
    GAME.timers.add(id);
    return id;
}

function gameClearAllTimers() {
    GAME.timers.forEach(id => clearTimeout(id));
    GAME.timers.clear();
}

function initGameCanvas() {
    const canvas = document.getElementById('gameCanvas');
    if (!canvas) return;
    GAME.canvas = canvas;
    GAME.ctx = canvas.getContext('2d');
    resizeGameCanvas();
    window.addEventListener('resize', resizeGameCanvas);
}

function resizeGameCanvas() {
    if (!GAME.canvas) return;
    const rect = GAME.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    GAME.dpr = dpr;
    GAME.width = rect.width;
    GAME.height = rect.height;
    GAME.canvas.width = Math.round(rect.width * dpr);
    GAME.canvas.height = Math.round(rect.height * dpr);
    GAME.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const newBaseW = Math.min(110, GAME.width * 0.22);
    GAME.basePaddleW = newBaseW;
    if (GAME.expandTimer <= 0) {
        GAME.paddle.w = newBaseW;
    }
    // 🆕 Paleta más cerca del borde inferior en un canvas más bajo
    GAME.paddle.y = GAME.height - 30;
    GAME.paddle.x = Math.max(0, Math.min(GAME.paddle.x, GAME.width - GAME.paddle.w));
    if (GAME.blocks.length > 0 && !GAME.running) rebuildBlocks();
}

function rebuildBlocks() {
    const { cols, topOffset, gap, sideMargin } = GAME.layout;
    const playWidth = GAME.width - sideMargin * 2;
    const blockW = (playWidth - gap * (cols - 1)) / cols;
    // 🆕 Altura del bloque proporcional al nuevo alto (antes 0.025, ahora 0.045)
    const blockH = Math.max(12, Math.min(18, GAME.height * 0.045));
    const rows = Math.min(4 + Math.floor((GAME.level - 1) / 2), 7);
    GAME.blocks = [];

    const rowColors = ['#f45bd8', '#a56bff', '#2be3ff', '#42e4b3', '#ffad62', '#5b7cff', '#ff6d8c'];

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            let hp = 1;
            let type = 'normal';

            if (row === 0 && col % 3 === 0) {
                hp = 2;
                type = 'hard';
            } else if (row === 1 && GAME.level >= 3 && col % 4 === 0) {
                hp = 2;
                type = 'hard';
            }

            GAME.blocks.push({
                x: sideMargin + col * (blockW + gap),
                y: topOffset + row * (blockH + gap),
                w: blockW,
                h: blockH,
                hp,
                maxHp: hp,
                type,
                row,
                col,
                color: rowColors[row % rowColors.length],
                alive: true,
                hitFlash: 0
            });
        }
    }
}

function spawnBall(fromPaddle = true) {
    const ball = {
        x: GAME.paddle.x + GAME.paddle.w / 2,
        y: GAME.paddle.y - 10, // 🆕 Ajustado a -10 (antes -12)
        r: 7, // 🆕 Bola ligeramente más pequeña para el nuevo espacio
        vx: 0,
        vy: 0,
        stuck: fromPaddle,
        stuckOffset: 0,
        trail: []
    };
    GAME.balls.push(ball);
    return ball;
}

function launchBalls() {
    GAME.balls.forEach(ball => {
        if (ball.stuck) {
            ball.stuck = false;
            const speed = 5.5 + GAME.level * 0.4;
            const angle = -Math.PI / 2 + (Math.random() * 0.5 - 0.25);
            ball.vx = Math.cos(angle) * speed;
            ball.vy = Math.sin(angle) * speed;
        }
    });
}

function startGame() {
    if (GAME.running) return;
    gameClearAllTimers();
    GAME.level = 1;
    GAME.lives = 3;
    GAME.score = 0;
    GAME.combo = 0;
    GAME.particles = [];
    GAME.powerups = [];
    GAME.balls = [];
    GAME.winTransition = false;
    GAME.paddle.w = Math.min(110, GAME.width * 0.22);
    GAME.paddle.h = 12; // 🆕 Paleta ligeramente más delgada
    GAME.basePaddleW = GAME.paddle.w;
    GAME.expandTimer = 0;
    GAME.paddle.y = GAME.height - 30; // 🆕 Ajustado
    GAME.paddle.x = (GAME.width - GAME.paddle.w) / 2;
    GAME.paddle.targetX = GAME.paddle.x;
    rebuildBlocks();
    spawnBall(true);
    updateGameHud();
    document.getElementById('startGame').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    GAME.running = true;
    GAME.lastTime = performance.now();
    GAME.accumulator = 0;
    GAME.countdown = 3;
    GAME.rafId = requestAnimationFrame(gameLoop);
}

function stopGame() {
    GAME.running = false;
    if (GAME.rafId) cancelAnimationFrame(GAME.rafId);
    GAME.rafId = null;
    gameClearAllTimers();
}

function endGame() {
    stopGame();
    const screen = document.getElementById('gameOverScreen');
    document.getElementById('gameFinalScore').textContent = `${GAME.score} puntos`;
    const record = Number(localStorage.getItem('niunx-arkanoid-record') || 0);
    if (GAME.score > record) {
        localStorage.setItem('niunx-arkanoid-record', String(GAME.score));
        document.getElementById('gameFinalMessage').textContent = `¡Nuevo récord! Superaste los ${record} puntos anteriores.`;
    } else {
        document.getElementById('gameFinalMessage').textContent = `Récord: ${record} puntos.`;
    }
    screen.classList.remove('hidden');
}

function updateGameHud() {
    const lvl = document.getElementById('gameLevel');
    const sc = document.getElementById('gameScore');
    const lv = document.getElementById('gameLives');
    if (lvl) lvl.textContent = GAME.level;
    if (sc) sc.textContent = GAME.score;
    if (lv) {
        const hearts = [];
        for (let i = 0; i < 3; i++) hearts.push(i < GAME.lives ? '♥' : '♡');
        lv.textContent = hearts.join('');
    }
}

function gameLoop(now) {
    if (!GAME.running) return;
    const dt = Math.min(now - GAME.lastTime, 100);
    GAME.lastTime = now;

    if (document.hidden) {
        GAME.accumulator = 0;
        GAME.rafId = requestAnimationFrame(gameLoop);
        return;
    }

    GAME.accumulator += dt;
    let steps = 0;
    while (GAME.accumulator >= GAME.fixedStep && steps < 6) {
        updateGame(GAME.fixedStep / 16.67);
        GAME.accumulator -= GAME.fixedStep;
        steps++;
    }
    if (steps === 6) GAME.accumulator = 0;

    renderGame();
    GAME.rafId = requestAnimationFrame(gameLoop);
}

function updateGame(step) {
    if (GAME.countdown > 0) {
        GAME.countdown -= 1 / 60;
        return;
    }

    if (GAME.input.pointerActive) {
        const diff = GAME.paddle.targetX - GAME.paddle.x;
        GAME.paddle.x += diff * 0.35;
    } else {
        if (GAME.input.left) GAME.paddle.x -= 8 * step;
        if (GAME.input.right) GAME.paddle.x += 8 * step;
    }
    GAME.paddle.x = Math.max(6, Math.min(GAME.width - GAME.paddle.w - 6, GAME.paddle.x));

    if (GAME.comboTimer > 0) {
        GAME.comboTimer -= step;
        if (GAME.comboTimer <= 0) GAME.combo = 0;
    }

    if (GAME.expandTimer > 0) {
        GAME.expandTimer -= step / 60;
        if (GAME.expandTimer <= 0) {
            GAME.expandTimer = 0;
            const center = GAME.paddle.x + GAME.paddle.w / 2;
            GAME.paddle.w = GAME.basePaddleW;
            GAME.paddle.x = Math.max(6, Math.min(GAME.width - GAME.paddle.w - 6, center - GAME.paddle.w / 2));
        }
    }

    for (let i = GAME.balls.length - 1; i >= 0; i--) {
        const ball = GAME.balls[i];

        if (ball.stuck) {
            ball.x = GAME.paddle.x + GAME.paddle.w / 2 + ball.stuckOffset;
            ball.y = GAME.paddle.y - ball.r - 2;
            continue;
        }

        ball.trail.unshift({ x: ball.x, y: ball.y });
        if (ball.trail.length > 8) ball.trail.pop();

        const subSteps = 4;
        const sx = (ball.vx * step) / subSteps;
        const sy = (ball.vy * step) / subSteps;

        let removeBall = false;
        for (let s = 0; s < subSteps; s++) {
            ball.x += sx;
            ball.y += sy;

            if (ball.x - ball.r < 0) {
                ball.x = ball.r;
                ball.vx = Math.abs(ball.vx);
            } else if (ball.x + ball.r > GAME.width) {
                ball.x = GAME.width - ball.r;
                ball.vx = -Math.abs(ball.vx);
            }
            if (ball.y - ball.r < 0) {
                ball.y = ball.r;
                ball.vy = Math.abs(ball.vy);
            }

            if (
                ball.vy > 0 &&
                ball.y + ball.r >= GAME.paddle.y &&
                ball.y - ball.r <= GAME.paddle.y + GAME.paddle.h &&
                ball.x >= GAME.paddle.x - ball.r &&
                ball.x <= GAME.paddle.x + GAME.paddle.w + ball.r
            ) {
                const paddleCenter = GAME.paddle.x + GAME.paddle.w / 2;
                const hit = (ball.x - paddleCenter) / (GAME.paddle.w / 2);
                const clampedHit = Math.max(-1, Math.min(1, hit));
                const angle = clampedHit * (Math.PI / 3);
                const speed = Math.hypot(ball.vx, ball.vy);
                ball.vx = Math.sin(angle) * speed;
                ball.vy = -Math.cos(angle) * speed;
                ball.y = GAME.paddle.y - ball.r - 1;
                spawnParticles(ball.x, ball.y, GAME.colors.cyan, 4);
                break;
            }

            for (const block of GAME.blocks) {
                if (!block.alive) continue;
                if (
                    ball.x + ball.r > block.x &&
                    ball.x - ball.r < block.x + block.w &&
                    ball.y + ball.r > block.y &&
                    ball.y - ball.r < block.y + block.h
                ) {
                    const overlapLeft = ball.x + ball.r - block.x;
                    const overlapRight = block.x + block.w - (ball.x - ball.r);
                    const overlapTop = ball.y + ball.r - block.y;
                    const overlapBottom = block.y + block.h - (ball.y - ball.r);
                    const minX = Math.min(overlapLeft, overlapRight);
                    const minY = Math.min(overlapTop, overlapBottom);

                    if (minX < minY) {
                        ball.vx = -ball.vx;
                        ball.x += overlapLeft < overlapRight ? -minX : minX;
                    } else {
                        ball.vy = -ball.vy;
                        ball.y += overlapTop < overlapBottom ? -minY : minY;
                    }

                    hitBlock(block);
                    break;
                }
            }

            if (ball.y - ball.r > GAME.height) {
                removeBall = true;
                break;
            }
        }

        if (removeBall) {
            GAME.balls.splice(i, 1);
        }
    }

    if (GAME.balls.length === 0 && GAME.running && GAME.countdown <= 0) {
        GAME.lives -= 1;
        updateGameHud();
        if (GAME.lives <= 0) {
            endGame();
            return;
        }
        GAME.paddle.x = (GAME.width - GAME.paddle.w) / 2;
        GAME.paddle.targetX = GAME.paddle.x;
        spawnBall(true);
        GAME.countdown = 1.5;
    }

    for (let i = GAME.powerups.length - 1; i >= 0; i--) {
        const p = GAME.powerups[i];
        p.y += 3 * step;
        p.rot += 0.08 * step;

        if (
            p.y + 14 >= GAME.paddle.y &&
            p.y - 14 <= GAME.paddle.y + GAME.paddle.h &&
            p.x + 14 >= GAME.paddle.x &&
            p.x - 14 <= GAME.paddle.x + GAME.paddle.w
        ) {
            applyPowerUp(p.type);
            spawnParticles(p.x, p.y, GAME.colors.green, 10);
            GAME.powerups.splice(i, 1);
            continue;
        }

        if (p.y > GAME.height + 20) GAME.powerups.splice(i, 1);
    }

    for (let i = GAME.particles.length - 1; i >= 0; i--) {
        const pt = GAME.particles[i];
        pt.x += pt.vx * step;
        pt.y += pt.vy * step;
        pt.vy += 0.15 * step;
        pt.life -= 0.03 * step;
        if (pt.life <= 0) GAME.particles.splice(i, 1);
    }

    if (GAME.shake.duration > 0) {
        GAME.shake.duration -= step;
        GAME.shake.x = (Math.random() - 0.5) * GAME.shake.intensity;
        GAME.shake.y = (Math.random() - 0.5) * GAME.shake.intensity;
        GAME.shake.intensity *= 0.9;
    } else {
        GAME.shake.x = 0;
        GAME.shake.y = 0;
        GAME.shake.intensity = 0;
    }

    if (!GAME.winTransition) {
        const destructible = GAME.blocks.filter(b => b.type !== 'solid');
        if (destructible.length > 0 && destructible.every(b => !b.alive)) {
            GAME.winTransition = true;
            gameSetTimeout(() => {
                GAME.level += 1;
                GAME.score += 100;
                GAME.powerups = [];
                GAME.balls = [];
                GAME.paddle.w = Math.min(110, GAME.width * 0.22);
                GAME.basePaddleW = GAME.paddle.w;
                GAME.expandTimer = 0;
                rebuildBlocks();
                spawnBall(true);
                GAME.countdown = 2;
                updateGameHud();
                GAME.winTransition = false;
            }, 800);
        }
    }
}

function hitBlock(block) {
    block.hitFlash = 1;
    block.hp -= 1;
    if (block.hp <= 0) {
        block.alive = false;
        GAME.combo += 1;
        GAME.comboTimer = 1.2;
        const comboBonus = Math.min(GAME.combo, 10);
        const points = (10 + comboBonus * 2) * GAME.level;
        GAME.score += points;
        updateGameHud();
        spawnParticles(block.x + block.w / 2, block.y + block.h / 2, block.color, 8);
        triggerShake(1.5, 8);

        const roll = Math.random();
        if (roll < 0.10) spawnPowerUp(block.x + block.w / 2, block.y + block.h / 2, 'expand');
        else if (roll < 0.18) spawnPowerUp(block.x + block.w / 2, block.y + block.h / 2, 'multi');
        else if (roll < 0.22) spawnPowerUp(block.x + block.w / 2, block.y + block.h / 2, 'life');
    } else {
        spawnParticles(block.x + block.w / 2, block.y + block.h / 2, block.color, 3);
    }
}

function spawnPowerUp(x, y, type) {
    GAME.powerups.push({ x, y, type, rot: 0 });
}

function applyPowerUp(type) {
    if (type === 'expand') {
        if (GAME.expandTimer > 0) {
            return;
        }
        GAME.paddle.w = Math.min(GAME.width * 0.4, GAME.basePaddleW + 40);
        GAME.paddle.x = Math.min(GAME.paddle.x, GAME.width - GAME.paddle.w - 6);
        GAME.expandTimer = 8;
    } else if (type === 'multi') {
        const source = GAME.balls[0];
        if (source && !source.stuck && GAME.balls.length < 3) {
            const b1 = { ...source, vx: source.vx * 0.9, vy: source.vy * 0.9, trail: [] };
            const b2 = { ...source, vx: -source.vx * 0.9, vy: source.vy * 0.9, trail: [] };
            GAME.balls.push(b1, b2);
        }
    } else if (type === 'life') {
        GAME.lives = Math.min(3, GAME.lives + 1);
        updateGameHud();
    }
}

function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 4;
        GAME.particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1,
            life: 1,
            color,
            size: 1 + Math.random() * 3
        });
    }
}

function triggerShake(intensity, duration) {
    GAME.shake.intensity = Math.max(GAME.shake.intensity, intensity);
    GAME.shake.duration = duration;
}

function renderGame() {
    const ctx = GAME.ctx;
    const W = GAME.width;
    const H = GAME.height;

    ctx.setTransform(GAME.dpr, 0, 0, GAME.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    drawBackground(ctx, W, H);

    ctx.save();
    if (GAME.shake.duration > 0) {
        ctx.translate(GAME.shake.x, GAME.shake.y);
    }

    GAME.blocks.forEach(block => {
        if (!block.alive) return;
        drawBlock(ctx, block);
    });

    GAME.powerups.forEach(p => drawPowerUp(ctx, p));
    GAME.balls.forEach(ball => drawBall(ctx, ball));
    drawPaddle(ctx, GAME.paddle);

    GAME.particles.forEach(p => {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.restore();

    if (GAME.expandTimer > 0) {
        ctx.fillStyle = GAME.colors.cyan;
        ctx.font = `700 ${Math.min(14, W * 0.028)}px 'Space Grotesk', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.globalAlpha = 0.85;
        // 🆕 Ajustado a 36 (antes 54) para el nuevo alto
        ctx.fillText(`↔ EXPAND ${Math.ceil(GAME.expandTimer)}s`, W / 2, 36);
        ctx.globalAlpha = 1;
    }

    if (GAME.countdown > 0) {
        ctx.fillStyle = 'rgba(2,6,17,0.55)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = GAME.colors.cyan;
        ctx.font = `700 ${Math.min(72, W * 0.14)}px 'Space Grotesk', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const secs = Math.ceil(GAME.countdown);
        ctx.fillText(secs > 0 ? String(secs) : '¡YA!', W / 2, H / 2);
    }

    if (GAME.combo > 1 && GAME.comboTimer > 0) {
        ctx.fillStyle = GAME.colors.orange;
        ctx.font = `700 ${Math.min(22, W * 0.045)}px 'Space Grotesk', sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.globalAlpha = Math.min(1, GAME.comboTimer);
        // 🆕 Ajustado a 52 (antes 78) para el nuevo alto
        ctx.fillText(`COMBO x${GAME.combo}`, W - 20, 52);
        ctx.globalAlpha = 1;
    }
}

function drawBackground(ctx, W, H) {
    const grad = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H);
    grad.addColorStop(0, 'rgba(35, 60, 110, 0.35)');
    grad.addColorStop(1, 'rgba(7, 11, 26, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
}

function drawBlock(ctx, block) {
    ctx.save();
    ctx.shadowColor = block.color;
    ctx.shadowBlur = block.hitFlash > 0 ? 20 : 6;

    const grad = ctx.createLinearGradient(block.x, block.y, block.x, block.y + block.h);
    grad.addColorStop(0, block.color);
    grad.addColorStop(1, shadeColor(block.color, -40));
    ctx.fillStyle = grad;
    roundRect(ctx, block.x, block.y, block.w, block.h, 4);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    roundRect(ctx, block.x + 2, block.y + 1.5, block.w - 4, 2, 1);
    ctx.fill();

    if (block.type === 'hard' && block.hp === 1) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        roundRect(ctx, block.x + 2, block.y + 2, block.w - 4, block.h - 4, 3);
        ctx.fill();
    }

    if (block.hitFlash > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${block.hitFlash * 0.7})`;
        roundRect(ctx, block.x, block.y, block.w, block.h, 4);
        ctx.fill();
        block.hitFlash = Math.max(0, block.hitFlash - 0.18);
    }

    ctx.restore();
}

function drawBall(ctx, ball) {
    ball.trail.forEach((pt, i) => {
        const alpha = (1 - i / ball.trail.length) * 0.4;
        ctx.fillStyle = `rgba(43, 227, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, ball.r * (1 - i / ball.trail.length * 0.5), 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.save();
    ctx.shadowColor = GAME.colors.cyan;
    ctx.shadowBlur = 20;
    const grad = ctx.createRadialGradient(ball.x - 2, ball.y - 2, 1, ball.x, ball.y, ball.r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, GAME.colors.cyan);
    grad.addColorStop(1, '#1a6ba8');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawPaddle(ctx, paddle) {
    ctx.save();
    ctx.shadowColor = GAME.colors.cyan;
    ctx.shadowBlur = 18;
    const grad = ctx.createLinearGradient(paddle.x, paddle.y, paddle.x + paddle.w, paddle.y);
    grad.addColorStop(0, GAME.colors.cyan);
    grad.addColorStop(0.5, GAME.colors.violet);
    grad.addColorStop(1, GAME.colors.pink);
    ctx.fillStyle = grad;
    roundRect(ctx, paddle.x, paddle.y, paddle.w, paddle.h, 7);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    roundRect(ctx, paddle.x + 4, paddle.y + 2, paddle.w - 8, 3, 1.5);
    ctx.fill();
    ctx.restore();
}

function drawPowerUp(ctx, p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.shadowColor = GAME.colors.green;
    ctx.shadowBlur = 16;

    const colors = { expand: GAME.colors.cyan, multi: GAME.colors.violet, life: GAME.colors.pink };
    const icons = { expand: '↔', multi: '●●', life: '♥' };
    const color = colors[p.type] || GAME.colors.green;

    ctx.fillStyle = color;
    roundRect(ctx, -14, -14, 28, 28, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#071225';
    ctx.font = '700 16px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icons[p.type] || '?', 0, 1);
    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function shadeColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.min(255, (num >> 16) + percent));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + percent));
    const b = Math.max(0, Math.min(255, (num & 0x0000FF) + percent));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function bindGameControls() {
    const container = document.getElementById('miniGame');
    if (!container) return;

    window.addEventListener('keydown', (e) => {
        if (!GAME.running) return;
        if (['ArrowLeft', 'a', 'A'].includes(e.key)) GAME.input.left = true;
        if (['ArrowRight', 'd', 'D'].includes(e.key)) GAME.input.right = true;
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (GAME.balls.some(b => b.stuck)) launchBalls();
        }
        if (['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
        if (['ArrowLeft', 'a', 'A'].includes(e.key)) GAME.input.left = false;
        if (['ArrowRight', 'd', 'D'].includes(e.key)) GAME.input.right = false;
    });

    const onPointerMove = (e) => {
        if (!GAME.running) return;
        const rect = container.getBoundingClientRect();
        const scaleX = GAME.width / rect.width;
        const localX = (e.clientX - rect.left) * scaleX;
        GAME.paddle.targetX = Math.max(6, Math.min(GAME.width - GAME.paddle.w - 6, localX - GAME.paddle.w / 2));
        GAME.input.pointerActive = true;
    };

    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerdown', (e) => {
        if (!GAME.running) return;
        onPointerMove(e);
        if (GAME.balls.some(b => b.stuck)) launchBalls();
    });
    container.addEventListener('pointerleave', () => {
        GAME.input.pointerActive = false;
    });
    container.addEventListener('click', () => {
        if (!GAME.running) return;
        if (GAME.balls.some(b => b.stuck)) launchBalls();
    });
}

function buildSkyGame() {
    initGameCanvas();
    bindGameControls();

    const startBtn = document.getElementById('startGame');
    const restartBtn = document.getElementById('restartGame');
    if (startBtn) {
        startBtn.removeEventListener('click', startGame);
        startBtn.addEventListener('click', startGame);
    }
    if (restartBtn) {
        restartBtn.removeEventListener('click', startGame);
        restartBtn.addEventListener('click', startGame);
    }
}

window.addEventListener('beforeunload', () => {
    stopGame();
});

/* =================================================================
   ⚙️ EVENT LISTENERS GENERALES
   ================================================================= */

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
$$('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
$$('[data-open]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); openModal(button.dataset.open); }));
$$('.currency').forEach(button => button.addEventListener('click', () => setCurrency(button.dataset.currency)));
renderPaymentMethods();
$('[data-close="productModal"]')?.addEventListener('click', () => closeModal('productModal'));
$('#carouselPrev')?.addEventListener('click', () => { moveCarousel(-1); restartCarouselAutoplay(); });
$('#carouselNext')?.addEventListener('click', () => { moveCarousel(1); restartCarouselAutoplay(); });
document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCarouselAutoplay();
    else startCarouselAutoplay();
});
$$('.nav-link,[data-view]').forEach(button => button.addEventListener('click', () => { const view = button.dataset.view; if (!view) return; $$('.view').forEach(item => item.classList.toggle('active-view', item.id === view)); $$('.nav-link').forEach(item => item.classList.toggle('active', item.dataset.view === view)); }));
['openTopUp', 'openTopUpHero', 'openTopUpSmall', 'openTopUpCard'].forEach(id => $(`#${id}`)?.addEventListener('click', () => openModal('topUpModal')));
$('#amountSlider').addEventListener('input', updateAmount);

document.querySelectorAll('.amount-step').forEach(button => {
    button.addEventListener('click', () => {
        const direction = Number(button.dataset.step);
        const slider = $('#amountSlider');
        const next = Math.round((Number(slider.value) + direction * 0.10) * 10) / 10;
        const clamped = Math.min(50, Math.max(1, next));
        slider.value = clamped;
        updateAmount();
    });
});

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

/* =================================================================
   🎯 REFERRAL UI
   ================================================================= */

function createReferralUi() {
    try {
        const anchor = document.createElement('a');
        anchor.id = 'becomeCollaborator';
        anchor.href = '#';
        anchor.title = 'Conviértete en colaborador';
        anchor.style.fontSize = 'inherit';
        anchor.style.color = 'inherit';
        anchor.style.textDecoration = 'none';
        anchor.style.cursor = 'pointer';
        anchor.textContent = 'Conviértete en colaborador';
        const footer = document.querySelector('footer.site-footer');
        if (footer) {
            const rightSpan = footer.querySelector('span:nth-child(2)');
            if (rightSpan) {
                anchor.style.marginLeft = '12px';
                rightSpan.appendChild(anchor);
            } else {
                footer.appendChild(anchor);
            }
        } else {
            document.body.appendChild(anchor);
        }

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
                    modal.innerHTML = `<section class="modal-card"><p class="eyebrow">COLABORADOR</p><h2>Tu enlace de referido</h2><p class="helper">Comparte este enlace para obtener comisiones especiales por compras de tus referidos en Free Fire.</p><label class="form-label">Enlace<input id="referralLink" readonly></label><label class="form-label">Código<input id="referralCodeInput" readonly></label><p id="referralMessage" class="form-message"></p><div style="display:flex;gap:8px;margin-bottom:10px"><button id="copyReferral" class="button primary">Copiar enlace</button><button id="rotateReferral" class="button ghost">Rotar código</button><button id="closeReferral" class="button ghost">Cerrar</button></div><div id="referralEarningsContainer" style="max-height:360px;overflow:auto;margin-top:8px"></div></section>`;
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