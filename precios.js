// =========================================================
//  ACTUALIZA ESTOS VALORES DIARIAMENTE
// =========================================================
export const TASA_DOLAR_VES = 270.00; // Tasa de cambio de USD a Bolívares
export const VALOR_KGC_USD = 0.07; // 1 KingCoin (KGC) equivale a 0.07 USD
// =========================================================

// Precios base en USD para PUBG Mobile - NO CAMBIAR ESTOS VALORES
const pubgmobilePackagesUSD = [
    { id: 1, name: '60 UC', priceUSD: 0.99 },
    { id: 2, name: '300 + 25 UC', priceUSD: 5.04 },
    { id: 3, name: '600 + 60 UC', priceUSD: 9.85 },
    { id: 4, name: '1500 + 300 UC', priceUSD: 24.52 },
    { id: 5, name: '3000 + 850 UC', priceUSD: 49.28 },
    { id: 6, name: '6000 + 2100 UC', priceUSD: 98.56 }
];

// Precios base en USD para Free Fire - NO CAMBIAR ESTOS VALORES
const freefirePackagesUSD = [
    { id: 1, name: '100+10 Diamantes', priceUSD: 0.70 },
    { id: 2, name: '310+31 Diamantes', priceUSD: 2.21 },
    { id: 3, name: '520+52 Diamantes', priceUSD: 3.58 },
    { id: 4, name: '1050+105 Diamantes', priceUSD: 7.00 },
    { id: 5, name: '2180+218 Diamantes', priceUSD: 13.77 },
    { id: 6, name: '5600+560 Diamantes', priceUSD: 32.48 },
    { id: 7, name: 'Tarjeta Basica', priceUSD: 0.42 },
    { id: 7, name: 'Tarjeta Semanal', priceUSD: 1.50 },
    { id: 8, name: 'Tarjeta Mensual', priceUSD: 7.00 }
];

// Precios base en USD para KingsCoins - NO CAMBIAR ESTOS VALORES
const kingscoinsPackagesUSD = [
    { id: 1, name: '5 <i class="fas fa-crown"></i>', priceUSD: 0.35 },
    { id: 2, name: '10 <i class="fas fa-crown"></i>', priceUSD: 0.70 },
    { id: 3, name: '20 <i class="fas fa-crown"></i>', priceUSD: 1.40 },
    { id: 4, name: '50 <i class="fas fa-crown"></i>', priceUSD: 3.50 },
    { id: 5, name: '100 <i class="fas fa-crown"></i>', priceUSD: 7.00 },
    { id: 6, name: '200 <i class="fas fa-crown"></i>', priceUSD: 14.00 },
    { id: 7, name: '500 <i class="fas fa-crown"></i>', priceUSD: 35.00 },
    { id: 8, name: '1000 <i class="fas fa-crown"></i>', priceUSD: 70.00 }
];

// Precios base en USD para Arena Breakout - NO CAMBIAR ESTOS VALORES
const arenabreakoutPackagesUSD = [
    { id: 1, name: '60 Bonds', priceUSD: 1.01 },
    { id: 2, name: '335 Bonds', priceUSD: 5.00 },
    { id: 3, name: '675 Bonds', priceUSD: 9.92 },
    { id: 4, name: '1690 Bonds', priceUSD: 24.57 },
    { id: 5, name: '3400 Bonds', priceUSD: 49.06 },
    { id: 6, name: '6820 Bonds', priceUSD: 98.07 },
    { id: 8, name: 'Maletín Compuesto', priceUSD: 8.85 },
    { id: 9, name: 'Paquete Principiante', priceUSD: 1.01 },
    { id: 10, name: 'Maletín Antibalas', priceUSD: 2.97 },
    { id: 11, name: 'Pase Avanzado', priceUSD: 5.00 },
    { id: 12, name: 'Pase Premium', priceUSD: 14.85 }
];

// Precios base en USD para Blood Strike - NO CAMBIAR ESTOS VALORES
const bloodstrikePackagesUSD = [
    { id: 1, name: '105 Gold', priceUSD: 0.92 },
    { id: 2, name: '320 Gold', priceUSD: 2.80 },
    { id: 3, name: '540 Gold', priceUSD: 4.56 },
    { id: 4, name: '1100 Gold', priceUSD: 8.96 },
    { id: 5, name: '2260 Gold', priceUSD: 17.36 },
    { id: 6, name: '5800 Gold', priceUSD: 44.24 },
    { id: 7, name: 'Pase Elite', priceUSD: 3.75 },
    { id: 8, name: 'Pase Elite Plus', priceUSD: 8.70 }
];

// Precios base en USD para Mobile Legends - NO CAMBIAR ESTOS VALORES
const mobilelegendsPackagesUSD = [
    { id: 1, name: '50 Diamantes', priceUSD: 1.00 },
    { id: 2, name: '100 Diamantes', priceUSD: 2.00 },
    { id: 3, name: '250 Diamantes', priceUSD: 5.00 },
    { id: 4, name: '500 Diamantes', priceUSD: 10.00 },
    { id: 5, name: '1000 Diamantes', priceUSD: 20.00 },
    { id: 6, name: '2000 Diamantes', priceUSD: 40.00 }
];


// Calcula y exporta el array final de PUBG Mobile con todos los precios
export const pubgmobilePackages = pubgmobilePackagesUSD.map(pkg => {
    const priceVES = (pkg.priceUSD * TASA_DOLAR_VES).toFixed(2);
    const priceKGC = (pkg.priceUSD / VALOR_KGC_USD).toFixed(2);
    return {
        ...pkg,
        priceVES: parseFloat(priceVES),
        priceKGC: parseFloat(priceKGC)
    };
});

// Calcula y exporta el array final de Free Fire con todos los precios
export const freefirePackages = freefirePackagesUSD.map(pkg => {
    const priceVES = (pkg.priceUSD * TASA_DOLAR_VES).toFixed(2);
    const priceKGC = (pkg.priceUSD / VALOR_KGC_USD).toFixed(2);
    return {
        ...pkg,
        priceVES: parseFloat(priceVES),
        priceKGC: parseFloat(priceKGC)
    };
});

// Calcula y exporta el array final de KingsCoins con todos los precios
export const kingscoinsPackages = kingscoinsPackagesUSD.map(pkg => {
    const priceVES = (pkg.priceUSD * TASA_DOLAR_VES).toFixed(2);
    return {
        ...pkg,
        priceVES: parseFloat(priceVES),
        // Nota: El precio en KGC es el mismo valor de los KingsCoins,
        // por lo que no se hace una conversión adicional aquí.
        priceKGC: parseFloat(pkg.name.match(/\d+/)[0]) // Extrae el número del nombre
    };
});

// Calcula y exporta el array final de Arena Breakout con todos los precios
export const arenabreakoutPackages = arenabreakoutPackagesUSD.map(pkg => {
    const priceVES = (pkg.priceUSD * TASA_DOLAR_VES).toFixed(2);
    const priceKGC = (pkg.priceUSD / VALOR_KGC_USD).toFixed(2);
    return {
        ...pkg,
        priceVES: parseFloat(priceVES),
        priceKGC: parseFloat(priceKGC)
    };
});

// Calcula y exporta el array final de Blood Strike con todos los precios
export const bloodstrikePackages = bloodstrikePackagesUSD.map(pkg => {
    const priceVES = (pkg.priceUSD * TASA_DOLAR_VES).toFixed(2);
    const priceKGC = (pkg.priceUSD / VALOR_KGC_USD).toFixed(2);
    return {
        ...pkg,
        priceVES: parseFloat(priceVES),
        priceKGC: parseFloat(priceKGC)
    };
});

// Calcula y exporta el array final de Mobile Legends con todos los precios
export const mobilelegendsPackages = mobilelegendsPackagesUSD.map(pkg => {
    const priceVES = (pkg.priceUSD * TASA_DOLAR_VES).toFixed(2);
    const priceKGC = (pkg.priceUSD / VALOR_KGC_USD).toFixed(2);
    return {
        ...pkg,
        priceVES: parseFloat(priceVES),
        priceKGC: parseFloat(priceKGC)
    };
});