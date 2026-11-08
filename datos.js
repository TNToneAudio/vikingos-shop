/**
 * VIKINGOS SHOP - Datos, cola de envío y sincronización
 *
 * Este archivo no dibuja nada en pantalla. Se encarga de:
 *  1. Guardar los datos en el teléfono (para trabajar sin internet).
 *  2. Llevar una "cola" con los cambios que aún no llegaron a la planilla.
 *  3. Enviar esa cola a Google (Apps Script) cuando hay internet y traer los
 *     cambios del otro teléfono.
 *
 * Idea clave: la pantalla siempre muestra "datos del servidor + cambios pendientes",
 * por eso al tocar ALMACENAR o +/- el resultado se ve al instante.
 */
'use strict';

const VS = (window.VS = {});
VS.VERSION = '1.1';
VS.LIMITE_POCO_STOCK = 2;

/* ------------------------------------------------------------------
 * Estado en memoria
 * ------------------------------------------------------------------ */
VS.estado = {
  url: '',               // enlace /exec del servidor
  perfil: null,          // { usuario, codigo } de esta persona en este teléfono
  productos: {},         // última copia conocida del servidor, por id
  desde: '',             // fecha de la última sincronización (ISO)
  cola: [],              // cambios pendientes de enviar
  enLinea: navigator.onLine,
  sincronizando: false,
  ultimaSync: '',
  ultimoError: '',       // texto para mostrar si algo falla al sincronizar
  accesoInvalido: false, // el servidor ya no reconoce nuestro nombre/código
  avisos: []             // mensajes para mostrar (por ejemplo "se sumó a un producto existente")
};

VS.alCambiar = () => {};   // la pantalla se suscribe aquí
VS.notificar = () => { try { VS.alCambiar(); } catch (e) { console.error(e); } };

/* ------------------------------------------------------------------
 * Almacenamiento local (IndexedDB, con respaldo en memoria)
 * ------------------------------------------------------------------ */
let _db = null;
function abrirDB() {
  if (_db) return _db;
  _db = new Promise((ok, mal) => {
    if (!('indexedDB' in window)) return mal(new Error('Sin IndexedDB'));
    const r = indexedDB.open('vikingos-shop', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
  return _db;
}

VS.leerLocal = async function (clave) {
  try {
    const db = await abrirDB();
    return await new Promise((ok, mal) => {
      const q = db.transaction('kv').objectStore('kv').get(clave);
      q.onsuccess = () => ok(q.result);
      q.onerror = () => mal(q.error);
    });
  } catch (e) { console.warn('No se pudo leer', clave, e); return undefined; }
};

VS.guardarLocal = async function (clave, valor) {
  try {
    const db = await abrirDB();
    await new Promise((ok, mal) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(valor, clave);
      t.oncomplete = ok;
      t.onerror = () => mal(t.error);
    });
  } catch (e) { console.warn('No se pudo guardar', clave, e); }
};

VS.borrarLocal = async function (clave) {
  try {
    const db = await abrirDB();
    await new Promise((ok, mal) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').delete(clave);
      t.oncomplete = ok;
      t.onerror = () => mal(t.error);
    });
  } catch (e) { console.warn('No se pudo borrar', clave, e); }
};

VS.guardarServidor = () => VS.guardarLocal('servidor', { productos: VS.estado.productos, desde: VS.estado.desde });
VS.guardarCola = () => VS.guardarLocal('cola', VS.estado.cola);
VS.guardarPerfil = () => VS.guardarLocal('perfil', VS.estado.perfil);

/** Carga todo lo guardado en el teléfono. Se llama una vez al abrir la app. */
VS.cargar = async function () {
  const e = VS.estado;
  try { e.url = localStorage.getItem('vs_url') || ''; } catch (_) { e.url = ''; }
  const servidor = await VS.leerLocal('servidor');
  if (servidor) { e.productos = servidor.productos || {}; e.desde = servidor.desde || ''; }
  e.cola = (await VS.leerLocal('cola')) || [];
  e.perfil = (await VS.leerLocal('perfil')) || null;
};

/** Borra los datos de este teléfono (el servidor no se toca). */
VS.cerrarSesion = async function () {
  const e = VS.estado;
  e.perfil = null; e.productos = {}; e.desde = ''; e.cola = []; e.accesoInvalido = false; e.ultimoError = '';
  await Promise.all([VS.borrarLocal('perfil'), VS.borrarLocal('servidor'), VS.borrarLocal('cola')]);
  VS.notificar();
};

/* ------------------------------------------------------------------
 * Enlace del servidor
 * ------------------------------------------------------------------ */

/** Acepta el enlace completo (…/exec) o solo el ID de implementación. Devuelve '' si no es válido. */
VS.interpretarEnlace = function (texto) {
  const t = String(texto || '').trim();
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  if (/^[A-Za-z0-9_-]{20,200}$/.test(t)) return 'https://script.google.com/macros/s/' + t + '/exec';
  return '';
};

VS.guardarEnlace = function (url) {
  VS.estado.url = url;
  try { localStorage.setItem('vs_url', url); } catch (_) { /* sin almacenamiento */ }
};

/** Si la página se abrió con "#s=…", guarda el enlace y limpia la barra de direcciones. */
VS.leerEnlaceDeLaDireccion = function () {
  const m = location.hash.match(/^#s=(.+)$/);
  if (!m) return false;
  let valor = m[1];
  try { valor = decodeURIComponent(valor); } catch (_) { /* se usa tal cual */ }
  const url = VS.interpretarEnlace(valor);
  history.replaceState(null, '', location.pathname + location.search);
  if (!url) return false;
  VS.guardarEnlace(url);
  return true;
};

/* ------------------------------------------------------------------
 * Comunicación con el servidor
 * ------------------------------------------------------------------ */

/**
 * Envía una petición. Lanza { codigo: 'red' } si no hay conexión o
 * { codigo: 'respuesta_invalida' } si Google no devolvió lo esperado.
 * (Se envía como texto simple para que el navegador no pida permiso previo.)
 */
VS.llamar = async function (cuerpo, tiempoMax) {
  const e = VS.estado;
  if (!e.url) throw { codigo: 'sin_enlace' };
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), tiempoMax || 40000);
  const datos = Object.assign(
    { usuario: e.perfil && e.perfil.usuario, codigo: e.perfil && e.perfil.codigo }, cuerpo);
  let texto;
  try {
    const r = await fetch(e.url, { method: 'POST', body: JSON.stringify(datos), signal: ctl.signal, redirect: 'follow' });
    texto = await r.text();
  } catch (err) {
    throw { codigo: 'red' };
  } finally {
    clearTimeout(reloj);
  }
  try { return JSON.parse(texto); } catch (_) { throw { codigo: 'respuesta_invalida' }; }
};

/* ------------------------------------------------------------------
 * Utilidades
 * ------------------------------------------------------------------ */
VS.nuevoId = function (prefijo) {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return prefijo + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

VS.normalizar = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

VS.redondear = n => Math.round((n + Number.EPSILON) * 100) / 100;

/** 1234.5 -> "Bs 1.234,50" */
VS.formatoBs = function (n) {
  n = Number(n) || 0;
  const [entero, dec] = Math.abs(n).toFixed(2).split('.');
  return (n < 0 ? '-' : '') + 'Bs ' + entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
};

VS.aNumero = function (v) {
  const t = String(v == null ? '' : v).trim().replace(',', '.');
  if (t === '') return NaN;
  const n = Number(t);
  return isFinite(n) ? n : NaN;
};

VS.fechaCorta = function (iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  const hoy = new Date();
  const ayer = new Date(hoy.getTime() - 86400000);
  const hora = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === hoy.toDateString()) return 'hoy ' + hora;
  if (d.toDateString() === ayer.toDateString()) return 'ayer ' + hora;
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' }) + ' ' + hora;
};

VS.totalProducto = p => VS.redondear((Number(p.cantidad) || 0) * (Number(p.precioUnidad) || 0));
VS.pocoStock = p => p.estado === 'inventario' && p.cantidad <= VS.LIMITE_POCO_STOCK && !p.avisoDesactivado;
VS.claveDuplicado = p => [p.nombre, p.talla, p.color].map(VS.normalizar).join('|');

/** Busca un producto con el mismo nombre, talla y color (en inventario o en vendidos). */
VS.buscarDuplicado = function (lista, p, ignorarId) {
  const clave = VS.claveDuplicado(p);
  return lista.find(o => o.id !== ignorarId && VS.claveDuplicado(o) === clave) || null;
};

/* ------------------------------------------------------------------
 * Aplicar cambios pendientes sobre los datos del servidor
 * (misma lógica que el script de Google, para que lo que se ve coincida)
 * ------------------------------------------------------------------ */
function ajustarLocal(p, delta, fecha, usuario) {
  if (p.estado === 'vendido') {
    if (delta < 0) return;
    p.estado = 'inventario';
    p.fechaAgotado = '';
    p.cantidad = delta;
  } else {
    if (delta < 0) p.unidadesVendidas = (p.unidadesVendidas || 0) + Math.min(-delta, p.cantidad);
    p.cantidad = Math.max(0, p.cantidad + delta);
    if (p.cantidad === 0) { p.estado = 'vendido'; p.fechaAgotado = fecha; }
  }
  p.modificadoPor = usuario;
  p.modificadoEn = fecha;
  p.pendiente = true;
}

function aplicarOp(mapa, op, usuario) {
  const p = mapa[op.id];
  switch (op.tipo) {
    case 'crear':
      if (p) return;
      mapa[op.id] = Object.assign({}, op.producto, {
        id: op.id, miniatura: op.miniatura || '', fotoId: '', estado: 'inventario',
        creadoPor: usuario, creadoEn: op.fecha, modificadoPor: usuario, modificadoEn: op.fecha,
        fechaAgotado: '', unidadesVendidas: 0, pendiente: true
      });
      return;
    case 'editar':
      if (!p) return;
      Object.assign(p, op.cambios);
      if (op.miniatura) p.miniatura = op.miniatura;
      if (op.quitarFoto) { p.fotoId = ''; p.miniatura = ''; }
      p.modificadoPor = usuario; p.modificadoEn = op.fecha; p.pendiente = true;
      return;
    case 'ajustar':
      if (p) ajustarLocal(p, op.delta, op.fecha, usuario);
      return;
    case 'devolver':
      if (p && p.estado === 'vendido') ajustarLocal(p, op.cantidad, op.fecha, usuario);
      return;
  }
}

/** Lista de productos tal como debe verse: servidor + pendientes. */
VS.vista = function () {
  const e = VS.estado;
  const mapa = {};
  Object.keys(e.productos).forEach(id => { mapa[id] = Object.assign({}, e.productos[id]); });
  const usuario = e.perfil ? e.perfil.usuario : '';
  e.cola.forEach(op => aplicarOp(mapa, op, usuario));
  return Object.keys(mapa).map(id => mapa[id]);
};

/* ------------------------------------------------------------------
 * Cola de cambios
 * ------------------------------------------------------------------ */

/** Agrega un cambio a la cola; se verá al instante y se enviará en cuanto se pueda. */
VS.encolar = async function (op) {
  op.opId = VS.nuevoId('op_');
  op.fecha = new Date().toISOString();
  VS.estado.cola.push(op);
  VS.notificar();
  await VS.guardarCola();
  setTimeout(VS.sincronizar, 200);
};

function cuerpoDeOp(op) {
  switch (op.tipo) {
    case 'crear':
      return Object.assign({ accion: 'crear', id: op.id, opId: op.opId, permitirDuplicado: !!op.permitirDuplicado,
        foto: op.foto || null, miniatura: op.miniatura || '' }, op.producto);
    case 'editar':
      return { accion: 'editar', id: op.id, opId: op.opId, cambios: op.cambios || {},
        foto: op.foto || null, miniatura: op.miniatura || '', quitarFoto: !!op.quitarFoto };
    case 'ajustar':
      return { accion: 'ajustar', id: op.id, opId: op.opId, delta: op.delta };
    case 'devolver':
      return { accion: 'devolver', id: op.id, opId: op.opId, cantidad: op.cantidad };
  }
  return { accion: 'desconocida' };
}

const TEXTOS_ERROR = {
  producto_no_existe: 'Un cambio se descartó porque el producto ya no existe.',
  cantidad_invalida: 'Un cambio se descartó por tener una cantidad no válida.',
  precio_invalido: 'Un cambio se descartó por tener un precio no válido.',
  precio_venta_invalido: 'Un cambio se descartó por tener un precio de venta no válido.',
  nombre_invalido: 'Un cambio se descartó por tener un nombre no válido.',
  foto_invalida: 'Una foto no pudo guardarse (formato no válido).',
  foto_muy_grande: 'Una foto no pudo guardarse (es demasiado grande).',
  miniatura_invalida: 'Una foto no pudo guardarse (miniatura no válida).',
  id_invalido: 'Un cambio se descartó por un identificador no válido.'
};

/* ------------------------------------------------------------------
 * Sincronización
 * ------------------------------------------------------------------ */
VS.sincronizar = async function () {
  const e = VS.estado;
  if (e.sincronizando || !e.perfil || !e.url || !navigator.onLine || e.accesoInvalido) return;
  e.sincronizando = true;
  e.ultimoError = '';
  VS.notificar();
  try {
    // 1) Enviar los cambios pendientes, uno por uno y en orden.
    while (e.cola.length) {
      const op = e.cola[0];
      const r = await VS.llamar(cuerpoDeOp(op));

      if (r.ok && r.duplicado) {
        // Mientras tanto, la otra persona creó el mismo producto: se suma a ese.
        e.productos[r.producto.id] = r.producto;
        e.cola[0] = { tipo: 'ajustar', id: r.producto.id, delta: op.producto.cantidad,
          opId: VS.nuevoId('op_'), fecha: op.fecha };
        e.avisos.push('“' + r.producto.nombre + '” ya existía: se sumaron ' + op.producto.cantidad + ' unidades.');
        await VS.guardarCola();
        continue;
      }
      if (r.ok) {
        if (r.producto) e.productos[r.producto.id] = r.producto;
        e.cola.shift();
        await VS.guardarCola();
        VS.notificar();
        continue;
      }
      if (r.error === 'credenciales') {
        e.accesoInvalido = 'credenciales';
        throw { codigo: r.error };
      }
      if (r.error === 'bloqueado' || r.error === 'ocupado' || r.error === 'error_interno' || r.error === 'no_preparado') {
        throw { codigo: r.error };           // se reintentará más tarde
      }
      // Cualquier otro error significa que ese cambio nunca será válido: se descarta.
      e.avisos.push(TEXTOS_ERROR[r.error] || 'Un cambio se descartó (' + r.error + ').');
      e.cola.shift();
      await VS.guardarCola();
    }

    // 2) Traer lo que cambió desde la última vez (con 5 segundos de margen).
    const desde = e.desde ? new Date(Date.parse(e.desde) - 5000).toISOString() : '';
    const r = await VS.llamar({ accion: 'listar', desde: desde });
    if (r.ok) {
      r.productos.forEach(p => { e.productos[p.id] = p; });
      e.desde = r.ahora;
      e.ultimaSync = new Date().toISOString();
      await VS.guardarServidor();
    } else if (r.error === 'credenciales') {
      e.accesoInvalido = 'credenciales';
      throw { codigo: r.error };
    } else {
      throw { codigo: r.error };
    }
  } catch (err) {
    e.ultimoError = (err && err.codigo) || 'error';
  } finally {
    e.sincronizando = false;
    VS.notificar();
  }
};

/** Sincroniza de forma automática: al abrir, al volver la conexión y cada 30 segundos. */
VS.iniciarSincronizacionAutomatica = function () {
  window.addEventListener('online', () => { VS.estado.enLinea = true; VS.notificar(); VS.sincronizar(); });
  window.addEventListener('offline', () => { VS.estado.enLinea = false; VS.notificar(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) VS.sincronizar(); });
  setInterval(() => { if (!document.hidden) VS.sincronizar(); }, 30000);
  VS.sincronizar();
};

/* ------------------------------------------------------------------
 * Fotos: se reducen en el teléfono antes de enviarlas
 * ------------------------------------------------------------------ */
async function abrirImagen(archivo) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(archivo); } catch (_) { /* se prueba con <img> */ }
  }
  return await new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo abrir la imagen')); };
    img.src = url;
  });
}

function redimensionar(imagen, lado, calidad) {
  const ancho = imagen.width || imagen.naturalWidth, alto = imagen.height || imagen.naturalHeight;
  const esc = Math.min(1, lado / Math.max(ancho, alto));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(ancho * esc));
  c.height = Math.max(1, Math.round(alto * esc));
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(imagen, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', calidad);
}

/** Devuelve { foto: {mime, datos}, miniatura } listas para enviar. */
VS.procesarFoto = async function (archivo) {
  const img = await abrirImagen(archivo);
  const grande = redimensionar(img, 1000, 0.8);
  let calidad = 0.6, mini = redimensionar(img, 220, calidad);
  while (mini.length > 40000 && calidad > 0.2) { calidad -= 0.1; mini = redimensionar(img, 220, calidad); }
  if (img.close) img.close();
  return { foto: { mime: 'image/jpeg', datos: grande }, miniatura: mini };
};
