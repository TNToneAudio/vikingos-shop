/**
 * DAE LEE SHOP - Pantallas y botones
 *
 * Este archivo dibuja las pantallas y reacciona a lo que toca la persona.
 * Los datos y el envío a Google están en datos.js.
 */
'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ICONO = {
    menos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    mas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
  };

  let pestana = 'inventario';        // 'inventario' o 'vendidos'
  let pantallaActual = '';
  let modoAcceso = 'entrar';         // 'entrar' o 'crear'
  let instalacion = null;            // evento para "Instalar aplicación"
  let ultimaVezOculta = 0;

  /* ======================================================================
   * Pantallas
   * ====================================================================== */
  function mostrar(nombre) {
    pantallaActual = nombre;
    ['config', 'acceso', 'bloqueo'].forEach(n => { $('pantalla-' + n).hidden = (n !== nombre); });
    $('app').hidden = (nombre !== 'app');
    if (nombre === 'app') render();
    window.scrollTo(0, 0);
  }

  function toast(texto, ms) {
    const t = $('toast');
    t.textContent = texto;
    t.hidden = false;
    clearTimeout(toast.reloj);
    toast.reloj = setTimeout(() => { t.hidden = true; }, ms || 3200);
  }

  /** Abre un <dialog> y devuelve una promesa con el valor del botón pulsado. */
  function abrirDialogo(dlg) {
    return new Promise(ok => {
      const fin = () => { dlg.removeEventListener('close', fin); ok(dlg.returnValue); };
      dlg.addEventListener('close', fin);
      dlg.returnValue = 'cancelar';
      dlg.showModal();
    });
  }

  async function confirmar(titulo, texto, textoBoton) {
    $('conf-titulo').textContent = titulo;
    $('conf-texto').textContent = texto;
    $('conf-ok').textContent = textoBoton || 'Aceptar';
    return (await abrirDialogo($('dlg-confirmar'))) === 'ok';
  }

  const MENSAJES = {
    credenciales: 'El nombre o el código no son correctos.',
    bloqueado: 'Demasiados intentos fallidos. Espere unos 15 minutos e intente de nuevo.',
    registro_cerrado: 'Ya existen dos perfiles. Para crear otro hay que restablecer los usuarios.',
    nombre_en_uso: 'Ese nombre ya está en uso. Elija otro.',
    nombre_invalido: 'Escriba un nombre de al menos 2 letras.',
    codigo_invalido: 'El código debe tener exactamente 4 números.',
    red: 'No hay conexión con el servidor. Revise su internet e intente de nuevo.',
    respuesta_invalida: 'El servidor respondió algo inesperado. Revise que el enlace sea el correcto y que la implementación permita acceso a «cualquier persona».',
    no_preparado: 'El servidor aún no está preparado. Ejecute la función «preparar» en Apps Script.',
    error_interno: 'El servidor tuvo un problema. Intente de nuevo en un momento.',
    sin_enlace: 'Falta el enlace del servidor.'
  };
  const mensajeDe = codigo => MENSAJES[codigo] || ('Ocurrió un error (' + codigo + ').');

  /* ======================================================================
   * Pantalla 1: enlace del servidor
   * ====================================================================== */
  $('form-config').addEventListener('submit', ev => {
    ev.preventDefault();
    const url = VS.interpretarEnlace($('campo-enlace').value);
    if (!url) { $('error-config').textContent = 'Ese enlace no parece válido. Debe empezar con https:// o ser el ID de la implementación.'; return; }
    $('error-config').textContent = '';
    VS.guardarEnlace(url);
    entrarSegunEstado();
  });

  /* ======================================================================
   * Pantalla 2: entrar o crear perfil
   * ====================================================================== */
  const CODIGOS_OBVIOS = ['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
    '1234', '4321', '0123', '3210', '1212', '2580', '1122'];

  function ponerModoAcceso(modo) {
    modoAcceso = modo;
    $('tab-entrar').setAttribute('aria-selected', String(modo === 'entrar'));
    $('tab-crear').setAttribute('aria-selected', String(modo === 'crear'));
    $('fila-confirmar').hidden = (modo !== 'crear');
    $('btn-acceso').textContent = modo === 'crear' ? 'Crear perfil' : 'Entrar';
    $('ayuda-acceso').textContent = modo === 'crear'
      ? 'Elija un código que no sea obvio (evite 1234 o 0000). Su nombre aparecerá en cada cambio que haga.'
      : '';
    $('error-acceso').textContent = '';
  }

  async function prepararAcceso() {
    ponerModoAcceso('entrar');
    $('acc-nombre').value = ''; $('acc-codigo').value = ''; $('acc-codigo2').value = '';
    $('tab-crear').hidden = false;
    // Se pregunta si todavía hay lugar para crear perfiles.
    try {
      const r = await VS.llamar({ accion: 'estado' }, 15000);
      if (r.ok) {
        $('tab-crear').hidden = !r.registroAbierto;
        if (r.registroAbierto) ponerModoAcceso('crear');   // aún hay lugar: lo más probable es que sea su primera vez
      }
    } catch (_) { /* sin conexión: se deja «Entrar» por defecto */ }
  }

  $('tab-entrar').addEventListener('click', () => ponerModoAcceso('entrar'));
  $('tab-crear').addEventListener('click', () => ponerModoAcceso('crear'));
  $('btn-cambiar-enlace').addEventListener('click', () => { $('campo-enlace').value = VS.estado.url; mostrar('config'); });

  $('form-acceso').addEventListener('submit', async ev => {
    ev.preventDefault();
    const err = $('error-acceso');
    const nombre = $('acc-nombre').value.replace(/\s+/g, ' ').trim();
    const codigo = $('acc-codigo').value.trim();
    err.textContent = '';
    if (nombre.length < 2) { err.textContent = mensajeDe('nombre_invalido'); return; }
    if (!/^\d{4}$/.test(codigo)) { err.textContent = mensajeDe('codigo_invalido'); return; }
    if (modoAcceso === 'crear') {
      if (CODIGOS_OBVIOS.includes(codigo)) { err.textContent = 'Ese código es muy fácil de adivinar. Elija otro.'; return; }
      if ($('acc-codigo2').value.trim() !== codigo) { err.textContent = 'Los dos códigos no coinciden.'; return; }
    }
    const boton = $('btn-acceso');
    boton.disabled = true;
    try {
      const r = await VS.llamar({ accion: modoAcceso === 'crear' ? 'registrar' : 'ingresar', usuario: nombre, codigo: codigo }, 30000);
      if (!r.ok) { err.textContent = mensajeDe(r.error); return; }
      const cambioDeUsuario = VS.estado.perfil && VS.estado.perfil.usuario !== r.nombre;
      if (cambioDeUsuario && VS.estado.cola.length) VS.estado.cola = [];
      VS.estado.perfil = { usuario: r.nombre, codigo: codigo };
      VS.estado.accesoInvalido = false;
      await VS.guardarPerfil();
      await VS.guardarCola();
      toast(modoAcceso === 'crear' ? 'Perfil creado. ¡Bienvenido, ' + r.nombre + '!' : 'Bienvenido, ' + r.nombre);
      mostrar('app');
      VS.sincronizar();
    } catch (e) {
      err.textContent = mensajeDe(e && e.codigo);
    } finally {
      boton.disabled = false;
    }
  });

  /* ======================================================================
   * Pantalla 3: bloqueo con código
   * ====================================================================== */
  let tecleado = '';
  let fallosLocales = 0;
  let bloqueadoHasta = 0;

  function prepararBloqueo() {
    tecleado = '';
    $('bloqueo-saludo').textContent = 'Hola, ' + VS.estado.perfil.usuario;
    $('error-bloqueo').textContent = '';
    pintarPuntos();
  }
  function pintarPuntos() {
    Array.from($('puntos').children).forEach((p, i) => p.classList.toggle('lleno', i < tecleado.length));
  }
  function construirTeclado() {
    const t = $('teclado');
    const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'borrar'];
    t.innerHTML = teclas.map(k => k === '' ? '<span class="vacio"></span>'
      : k === 'borrar' ? '<button type="button" data-tecla="borrar" aria-label="Borrar">⌫</button>'
      : '<button type="button" data-tecla="' + k + '">' + k + '</button>').join('');
  }
  $('teclado').addEventListener('click', ev => {
    const b = ev.target.closest('[data-tecla]');
    if (!b) return;
    if (Date.now() < bloqueadoHasta) {
      $('error-bloqueo').textContent = 'Espere unos segundos antes de intentar de nuevo.';
      return;
    }
    $('error-bloqueo').textContent = '';
    if (b.dataset.tecla === 'borrar') tecleado = tecleado.slice(0, -1);
    else if (tecleado.length < 4) tecleado += b.dataset.tecla;
    pintarPuntos();
    if (tecleado.length === 4) comprobarCodigo();
  });
  function comprobarCodigo() {
    if (tecleado === VS.estado.perfil.codigo) {
      fallosLocales = 0;
      mostrar('app');
      VS.sincronizar();
      return;
    }
    fallosLocales++;
    $('error-bloqueo').textContent = 'Código incorrecto.';
    $('puntos').classList.add('sacudir');
    setTimeout(() => $('puntos').classList.remove('sacudir'), 400);
    if (fallosLocales >= 5) {
      bloqueadoHasta = Date.now() + 30000;
      fallosLocales = 0;
      $('error-bloqueo').textContent = 'Demasiados intentos. Espere 30 segundos.';
    }
    tecleado = '';
    setTimeout(pintarPuntos, 150);
  }
  $('btn-salir-bloqueo').addEventListener('click', salirDeEsteTelefono);

  async function salirDeEsteTelefono() {
    const pend = VS.estado.cola.length;
    const aviso = pend
      ? 'Hay ' + pend + ' cambio(s) que aún no se enviaron y se perderán. Conéctese a internet y sincronice antes de salir.'
      : 'Se borrarán los datos guardados en este teléfono. Su inventario en Google no se toca.';
    if (!(await confirmar('Salir de este teléfono', aviso, 'Salir'))) return;
    await VS.cerrarSesion();
    entrarSegunEstado();
  }

  /* ======================================================================
   * Pantalla 4: inventario
   * ====================================================================== */
  function pastilla() {
    const e = VS.estado, b = $('btn-sync');
    let texto = 'Sincronizado', clase = 'pastilla';
    if (e.accesoInvalido) { texto = 'Acceso no válido'; clase += ' fallo'; }
    else if (!navigator.onLine) { texto = e.cola.length ? 'Sin conexión · ' + e.cola.length + ' pendiente' + (e.cola.length > 1 ? 's' : '') : 'Sin conexión'; clase += ' sinred'; }
    else if (e.sincronizando) { texto = 'Sincronizando…'; clase += ' trabajando'; }
    else if (e.cola.length) { texto = e.cola.length + ' pendiente' + (e.cola.length > 1 ? 's' : ''); clase += ' pendiente'; }
    else if (e.ultimoError) { texto = 'No se pudo sincronizar'; clase += ' fallo'; }
    b.className = clase;
    b.textContent = texto;
    b.title = e.ultimoError ? mensajeDe(e.ultimoError) : 'Toque para sincronizar';
  }

  function miniaturaHtml(p) {
    return p.miniatura
      ? '<div class="miniatura"><img src="' + esc(p.miniatura) + '" alt="Foto de ' + esc(p.nombre) + '"></div>'
      : '<div class="miniatura sin-foto"><img src="logo-96.png" alt="" ></div>';
  }

  function lineaDetalle(p) {
    return [p.categoria, p.talla ? 'Talla ' + p.talla : '', p.color].filter(Boolean).map(esc).join(' · ');
  }

  function quienCuando(p) {
    return 'Modificado por ' + esc(p.modificadoPor || '—') + ' · ' + esc(VS.fechaCorta(p.modificadoEn));
  }

  function tarjetaInventario(p) {
    const etiquetas = [];
    if (VS.pocoStock(p)) etiquetas.push('<span class="etiqueta-chica aviso">Poco stock</span>');
    if (p.pendiente) etiquetas.push('<span class="etiqueta-chica espera">Sin enviar</span>');
    return '<article class="tarjeta' + (VS.pocoStock(p) ? ' poco' : '') + '" data-id="' + esc(p.id) + '">' +
      miniaturaHtml(p) +
      '<div><h3>' + esc(p.nombre) + '</h3>' +
      (lineaDetalle(p) ? '<p class="linea">' + lineaDetalle(p) + '</p>' : '') +
      '<p class="precios"><span>' + esc(VS.formatoBs(p.precioUnidad)) + ' c/u</span>' +
      '<span>Total <b>' + esc(VS.formatoBs(VS.totalProducto(p))) + '</b></span>' +
      (p.precioVenta != null ? '<span>Venta ' + esc(VS.formatoBs(p.precioVenta)) + '</span>' : '') + '</p>' +
      (etiquetas.length ? '<div class="etiquetas">' + etiquetas.join('') + '</div>' : '') +
      '</div>' +
      '<div class="pie-tarjeta">' +
      '<span class="meta">' + quienCuando(p) + '</span>' +
      '<span class="contador-cantidad">' +
      '<button type="button" data-accion="menos" aria-label="Quitar una unidad de ' + esc(p.nombre) + '">' + ICONO.menos + '</button>' +
      '<button type="button" class="numero" data-accion="cantidad" aria-label="Cantidad: ' + p.cantidad + '. Toque para cambiarla">' + p.cantidad + '</button>' +
      '<button type="button" data-accion="mas" aria-label="Agregar una unidad de ' + esc(p.nombre) + '">' + ICONO.mas + '</button>' +
      '</span></div></article>';
  }

  function valorVendido(p) {
    return VS.redondear((p.unidadesVendidas || 0) * (p.precioVenta != null ? p.precioVenta : p.precioUnidad));
  }

  function tarjetaVendido(p) {
    return '<article class="tarjeta" data-id="' + esc(p.id) + '">' +
      miniaturaHtml(p) +
      '<div><h3>' + esc(p.nombre) + '</h3>' +
      (lineaDetalle(p) ? '<p class="linea">' + lineaDetalle(p) + '</p>' : '') +
      '<p class="precios"><span>Vendidas <b>' + (p.unidadesVendidas || 0) + '</b></span>' +
      '<span>Total <b>' + esc(VS.formatoBs(valorVendido(p))) + '</b></span></p>' +
      '<p class="linea">Agotado: ' + esc(VS.fechaCorta(p.fechaAgotado)) + '</p>' +
      (p.pendiente ? '<div class="etiquetas"><span class="etiqueta-chica espera">Sin enviar</span></div>' : '') +
      '</div>' +
      '<div class="pie-tarjeta"><span class="meta">' + quienCuando(p) + '</span>' +
      '<button type="button" class="btn btn-borde" data-accion="devolver">Devolver al inventario</button></div>' +
      '</article>';
  }

  function render() {
    if (pantallaActual !== 'app') return;
    pastilla();
    const vista = VS.vista();
    const inv = vista.filter(p => p.estado === 'inventario');
    const ven = vista.filter(p => p.estado === 'vendido');
    $('cont-inv').textContent = inv.length;
    $('cont-ven').textContent = ven.length;

    const q = VS.normalizar($('buscar').value);
    const coincide = p => !q || VS.normalizar([p.nombre, p.categoria, p.talla, p.color].join(' ')).includes(q);

    // Resumen superior
    const resumen = $('resumen');
    if (pestana === 'inventario') {
      const total = VS.redondear(inv.reduce((s, p) => s + VS.totalProducto(p), 0));
      const unidades = inv.reduce((s, p) => s + p.cantidad, 0);
      const poco = inv.filter(VS.pocoStock).length;
      resumen.className = 'resumen';
      resumen.innerHTML =
        '<div class="tarjeta-resumen"><div class="etiqueta">Valor total del inventario</div><div class="valor">' + esc(VS.formatoBs(total)) +
        '</div><div class="detalle">' + inv.length + ' producto' + (inv.length === 1 ? '' : 's') + ' · ' + unidades + ' unidad' + (unidades === 1 ? '' : 'es') + '</div></div>' +
        '<div class="tarjeta-resumen' + (poco ? ' alerta' : '') + '"><div class="etiqueta">Poco stock</div><div class="valor">' + poco +
        '</div><div class="detalle">' + (poco ? 'revisar pronto' : 'todo en orden') + '</div></div>';
    } else {
      const total = VS.redondear(ven.reduce((s, p) => s + valorVendido(p), 0));
      resumen.className = 'resumen una-columna';
      resumen.innerHTML =
        '<div class="tarjeta-resumen"><div class="etiqueta">Total acumulado de vendidos</div><div class="valor">' + esc(VS.formatoBs(total)) +
        '</div><div class="detalle">' + ven.length + ' producto' + (ven.length === 1 ? '' : 's') + ' agotado' + (ven.length === 1 ? '' : 's') +
        ' · calculado con el precio de venta (o el precio por unidad si no tiene)</div></div>';
    }

    // Lista
    const base = pestana === 'inventario' ? inv : ven;
    const filtrados = base.filter(coincide);
    const clave = pestana === 'inventario' ? 'modificadoEn' : 'fechaAgotado';
    filtrados.sort((a, b) => String(b[clave] || '').localeCompare(String(a[clave] || '')));
    const lista = $('lista');
    if (!filtrados.length) {
      const vacio = q ? 'No hay productos que coincidan con la búsqueda.'
        : pestana === 'inventario' ? 'Aún no hay productos. Toque «Nuevo producto» para almacenar el primero.'
        : 'Cuando un producto se agote, aparecerá aquí.';
      lista.innerHTML = '<div class="vacio-lista"><img src="logo-96.png" alt=""><p>' + esc(vacio) + '</p></div>';
    } else {
      lista.innerHTML = filtrados.map(pestana === 'inventario' ? tarjetaInventario : tarjetaVendido).join('');
    }

    // Mensajes pendientes de mostrar
    if (VS.estado.avisos.length) toast(VS.estado.avisos.shift(), 5000);
    if (VS.estado.accesoInvalido === 'credenciales') accesoPerdido();
  }

  let avisandoAcceso = false;
  async function accesoPerdido() {
    if (avisandoAcceso) return;
    avisandoAcceso = true;
    await confirmar('Hay que volver a entrar',
      'El servidor ya no reconoce su nombre o su código (por ejemplo, si se restablecieron los usuarios). Sus cambios pendientes se conservan.', 'Entrar de nuevo');
    VS.estado.perfil = null;
    VS.estado.accesoInvalido = false;
    await VS.guardarPerfil();
    avisandoAcceso = false;
    entrarSegunEstado();
  }

  function cambiarPestana(nueva) {
    pestana = nueva;
    $('tab-inventario').setAttribute('aria-selected', String(nueva === 'inventario'));
    $('tab-vendidos').setAttribute('aria-selected', String(nueva === 'vendidos'));
    render();
  }
  $('tab-inventario').addEventListener('click', () => cambiarPestana('inventario'));
  $('tab-vendidos').addEventListener('click', () => cambiarPestana('vendidos'));
  $('buscar').addEventListener('input', render);
  $('btn-sync').addEventListener('click', () => { VS.estado.ultimoError = ''; VS.sincronizar(); });

  /* ---------- Acciones sobre las tarjetas ---------- */
  const buscarProducto = id => VS.vista().find(p => p.id === id);

  $('lista').addEventListener('click', async ev => {
    const tarjeta = ev.target.closest('[data-id]');
    if (!tarjeta) return;
    const id = tarjeta.dataset.id;
    const boton = ev.target.closest('[data-accion]');
    const p = buscarProducto(id);
    if (!p) return;
    if (!boton) { abrirFormulario(p); return; }
    switch (boton.dataset.accion) {
      case 'mas': await VS.encolar({ tipo: 'ajustar', id: id, delta: 1 }); break;
      case 'menos':
        if (p.cantidad <= 1 && !(await confirmar('Última unidad',
          'Es la última unidad de «' + p.nombre + '». Al quitarla, el producto pasará a Vendidos.', 'Pasar a Vendidos'))) return;
        await VS.encolar({ tipo: 'ajustar', id: id, delta: -1 });
        if (p.cantidad <= 1) toast('«' + p.nombre + '» pasó a Vendidos.');
        break;
      case 'cantidad': await cambiarCantidad(p); break;
      case 'devolver': await devolverAlInventario(p); break;
    }
  });

  async function cambiarCantidad(p) {
    $('cant-texto').textContent = p.nombre + ' · ahora hay ' + p.cantidad;
    $('cant-valor').value = String(p.cantidad);
    $('error-cantidad').textContent = '';
    const dlg = $('dlg-cantidad');
    const resultado = await new Promise(ok => {
      const manejar = ev => {
        const n = parseInt($('cant-valor').value, 10);
        if (ev.submitter && ev.submitter.value === 'ok' && (isNaN(n) || n < 0 || String(n) !== $('cant-valor').value.trim())) {
          ev.preventDefault();
          $('error-cantidad').textContent = 'Escriba un número entero (0 o más).';
        }
      };
      $('form-cantidad').addEventListener('submit', manejar);
      abrirDialogo(dlg).then(v => { $('form-cantidad').removeEventListener('submit', manejar); ok(v); });
      setTimeout(() => { $('cant-valor').focus(); $('cant-valor').select(); }, 50);
    });
    if (resultado !== 'ok') return;
    const nueva = parseInt($('cant-valor').value, 10);
    const delta = nueva - p.cantidad;
    if (delta === 0) return;
    await VS.encolar({ tipo: 'ajustar', id: p.id, delta: delta });
    if (nueva === 0) toast('«' + p.nombre + '» pasó a Vendidos.');
  }

  async function devolverAlInventario(p) {
    $('dev-texto').textContent = p.nombre;
    $('dev-valor').value = '1';
    $('error-devolver').textContent = '';
    const resultado = await new Promise(ok => {
      const manejar = ev => {
        const n = parseInt($('dev-valor').value, 10);
        if (ev.submitter && ev.submitter.value === 'ok' && (isNaN(n) || n < 1 || String(n) !== $('dev-valor').value.trim())) {
          ev.preventDefault();
          $('error-devolver').textContent = 'Escriba un número entero de 1 o más.';
        }
      };
      $('form-devolver').addEventListener('submit', manejar);
      abrirDialogo($('dlg-devolver')).then(v => { $('form-devolver').removeEventListener('submit', manejar); ok(v); });
      setTimeout(() => { $('dev-valor').focus(); $('dev-valor').select(); }, 50);
    });
    if (resultado !== 'ok') return;
    const n = parseInt($('dev-valor').value, 10);
    await VS.encolar({ tipo: 'devolver', id: p.id, cantidad: n });
    toast('«' + p.nombre + '» volvió al inventario (' + n + ').');
    cambiarPestana('inventario');
  }

  /* ======================================================================
   * Formulario de producto (nuevo y edición)
   * ====================================================================== */
  const F = {
    modo: 'nuevo', original: null,
    fotoNueva: null,       // { foto, miniatura } si se eligió una foto
    fotoVista: '',         // lo que se muestra en el recuadro
    quitarFoto: false
  };

  function pintarFoto() {
    const caja = $('foto-vista');
    if (F.fotoVista) { caja.className = 'foto-vista'; caja.innerHTML = '<img src="' + esc(F.fotoVista) + '" alt="Vista previa de la foto">'; }
    else { caja.className = 'foto-vista vacia'; caja.innerHTML = '<img src="logo-96.png" alt="Sin foto">'; }
    $('btn-quitar-foto').hidden = !F.fotoVista;
  }

  function totalEnVivo() {
    const c = parseInt($('p-cantidad').value, 10), pr = VS.aNumero($('p-precio').value);
    const el = $('total-vivo');
    if (F.modo === 'editar') { el.textContent = ''; return; }
    el.textContent = (c >= 1 && !isNaN(pr) && pr >= 0)
      ? 'Total: ' + c + ' × ' + VS.formatoBs(pr) + ' = ' + VS.formatoBs(VS.redondear(c * pr)) : '';
  }

  function abrirFormulario(p) {
    F.modo = p ? 'editar' : 'nuevo';
    F.original = p || null;
    F.fotoNueva = null; F.quitarFoto = false;
    F.fotoVista = p ? (p.miniatura || '') : '';
    $('producto-titulo').textContent = p ? 'Editar producto' : 'Nuevo producto';
    $('btn-almacenar').textContent = p ? 'GUARDAR CAMBIOS' : 'ALMACENAR';
    $('bloque-cantidad').hidden = !!p;
    $('p-nombre').value = p ? p.nombre : '';
    $('p-cantidad').value = '';
    $('p-precio').value = p ? String(p.precioUnidad).replace('.', ',') : '';
    $('p-talla').value = p ? p.talla : '';
    $('p-color').value = p ? p.color : '';
    $('p-venta').value = p && p.precioVenta != null ? String(p.precioVenta).replace('.', ',') : '';
    $('p-desc').value = p ? p.descripcion : '';
    $('p-sinaviso').checked = p ? !!p.avisoDesactivado : false;
    const cat = p ? p.categoria : '';
    const radios = document.querySelectorAll('input[name="p-cat"]');
    let hallada = false;
    radios.forEach(r => { if (r.value === cat) { r.checked = true; hallada = true; } });
    if (!hallada) radios[radios.length - 1].checked = true;
    $('p-meta').textContent = p ? 'Cantidad actual: ' + p.cantidad + ' (use los botones + y − de la lista, o toque el número). ' + 'Creado por ' + (p.creadoPor || '—') + ' · ' + VS.fechaCorta(p.creadoEn) + '.' : '';
    $('error-producto').textContent = '';
    ['p-nombre', 'p-cantidad', 'p-precio'].forEach(i => $(i).removeAttribute('aria-invalid'));
    pintarFoto();
    totalEnVivo();
    $('dlg-producto').showModal();
    $('dlg-producto').querySelector('.hoja-cuerpo').scrollTop = 0;
  }

  function cerrarFormulario() { $('dlg-producto').close(); }

  $('btn-nuevo').addEventListener('click', () => abrirFormulario(null));
  $('producto-cerrar').addEventListener('click', cerrarFormulario);
  $('p-cantidad').addEventListener('input', totalEnVivo);
  $('p-precio').addEventListener('input', totalEnVivo);

  $('btn-camara').addEventListener('click', () => $('in-camara').click());
  $('btn-galeria').addEventListener('click', () => $('in-galeria').click());
  $('btn-quitar-foto').addEventListener('click', () => {
    F.fotoNueva = null; F.fotoVista = ''; F.quitarFoto = !!(F.original && F.original.miniatura);
    pintarFoto();
  });
  async function alElegirFoto(ev) {
    const archivo = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!archivo) return;
    $('error-producto').textContent = '';
    try {
      F.fotoNueva = await VS.procesarFoto(archivo);
      F.fotoVista = F.fotoNueva.foto.datos;
      F.quitarFoto = false;
      pintarFoto();
    } catch (e) {
      $('error-producto').textContent = 'No se pudo leer esa imagen. Pruebe con otra.';
    }
  }
  $('in-camara').addEventListener('change', alElegirFoto);
  $('in-galeria').addEventListener('change', alElegirFoto);

  function leerFormulario() {
    const marcada = document.querySelector('input[name="p-cat"]:checked');
    const venta = $('p-venta').value.trim();
    return {
      nombre: $('p-nombre').value.replace(/\s+/g, ' ').trim(),
      cantidadTexto: $('p-cantidad').value.trim(),
      precio: VS.aNumero($('p-precio').value),
      categoria: marcada ? marcada.value : '',
      talla: $('p-talla').value.replace(/\s+/g, ' ').trim(),
      color: $('p-color').value.replace(/\s+/g, ' ').trim(),
      ventaTexto: venta,
      venta: venta === '' ? null : VS.aNumero(venta),
      descripcion: $('p-desc').value.trim(),
      sinAviso: $('p-sinaviso').checked
    };
  }

  function validar(v) {
    const marcar = (id, malo) => { if (malo) $(id).setAttribute('aria-invalid', 'true'); else $(id).removeAttribute('aria-invalid'); return malo; };
    let msg = '', primero = '';
    const fallo = (id, texto) => { if (!msg) { msg = texto; primero = id; } };
    if (marcar('p-nombre', !v.nombre)) fallo('p-nombre', 'Escriba el nombre del producto.');
    if (F.modo === 'nuevo') {
      const c = parseInt(v.cantidadTexto, 10);
      if (marcar('p-cantidad', isNaN(c) || c < 1 || String(c) !== v.cantidadTexto)) fallo('p-cantidad', 'Indique la cantidad (un número entero de 1 o más).');
    }
    if (marcar('p-precio', isNaN(v.precio) || v.precio < 0)) fallo('p-precio', 'Indique el precio por unidad (por ejemplo 35,50).');
    if (v.venta !== null && (isNaN(v.venta) || v.venta < 0)) { $('p-venta').setAttribute('aria-invalid', 'true'); fallo('p-venta', 'El precio de venta no es válido.'); }
    else $('p-venta').removeAttribute('aria-invalid');
    $('error-producto').textContent = msg;
    if (primero) $(primero).focus();
    return !msg;
  }

  $('form-producto').addEventListener('submit', async ev => {
    ev.preventDefault();
    const v = leerFormulario();
    if (!validar(v)) return;
    const boton = $('btn-almacenar');
    boton.disabled = true;
    try {
      if (F.modo === 'editar') await guardarEdicion(v); else await almacenarNuevo(v);
    } finally { boton.disabled = false; }
  });

  async function almacenarNuevo(v) {
    const cantidad = parseInt(v.cantidadTexto, 10);
    const producto = {
      nombre: v.nombre, categoria: v.categoria, talla: v.talla, color: v.color,
      cantidad: cantidad, precioUnidad: VS.redondear(v.precio),
      precioVenta: v.venta === null ? null : VS.redondear(v.venta),
      descripcion: v.descripcion, avisoDesactivado: v.sinAviso
    };
    let permitirDuplicado = false;
    const dup = VS.buscarDuplicado(VS.vista(), producto);
    if (dup) {
      const decision = await preguntarDuplicado(dup, cantidad);
      if (decision === 'cancelar') return;
      if (decision === 'sumar') {
        await VS.encolar({ tipo: 'ajustar', id: dup.id, delta: cantidad });
        cerrarFormulario();
        cambiarPestana('inventario');
        toast('Se sumaron ' + cantidad + ' unidad' + (cantidad === 1 ? '' : 'es') + ' a «' + dup.nombre + '».');
        return;
      }
      permitirDuplicado = true;
    }
    await VS.encolar({
      tipo: 'crear', id: VS.nuevoId('p'), producto: producto, permitirDuplicado: permitirDuplicado,
      foto: F.fotoNueva ? F.fotoNueva.foto : null, miniatura: F.fotoNueva ? F.fotoNueva.miniatura : ''
    });
    cerrarFormulario();
    $('buscar').value = '';
    cambiarPestana('inventario');
    toast('Producto almacenado.');
    window.scrollTo(0, 0);
  }

  async function preguntarDuplicado(dup, cantidad) {
    const estado = dup.estado === 'vendido' ? 'Está en Vendidos (agotado).' : 'Hay ' + dup.cantidad + ' unidad' + (dup.cantidad === 1 ? '' : 'es') + ' en el inventario.';
    const detalle = [dup.talla ? 'talla ' + dup.talla : '', dup.color].filter(Boolean).join(', ');
    $('dup-texto').textContent = '«' + dup.nombre + '»' + (detalle ? ' (' + detalle + ')' : '') + ' ya está registrado. ' + estado;
    $('dup-sumar').textContent = 'Sumar ' + cantidad + ' unidad' + (cantidad === 1 ? '' : 'es') + ' al existente';
    return await abrirDialogo($('dlg-duplicado'));
  }

  async function guardarEdicion(v) {
    const o = F.original;
    const cambios = {};
    if (v.nombre !== o.nombre) cambios.nombre = v.nombre;
    if (v.categoria !== (o.categoria || '')) cambios.categoria = v.categoria;
    if (v.talla !== (o.talla || '')) cambios.talla = v.talla;
    if (v.color !== (o.color || '')) cambios.color = v.color;
    if (VS.redondear(v.precio) !== o.precioUnidad) cambios.precioUnidad = VS.redondear(v.precio);
    const ventaNueva = v.venta === null ? null : VS.redondear(v.venta);
    if (ventaNueva !== (o.precioVenta == null ? null : o.precioVenta)) cambios.precioVenta = ventaNueva;
    if (v.descripcion !== (o.descripcion || '')) cambios.descripcion = v.descripcion;
    if (v.sinAviso !== !!o.avisoDesactivado) cambios.avisoDesactivado = v.sinAviso;
    if (cambios.nombre || cambios.talla !== undefined || cambios.color !== undefined) {
      const otro = VS.buscarDuplicado(VS.vista(), Object.assign({}, o, cambios), o.id);
      if (otro && !(await confirmar('Ya existe otro igual',
        '«' + otro.nombre + '» con la misma talla y color ya está registrado. ¿Guardar de todos modos?', 'Guardar igual'))) return;
    }
    const hayFoto = !!F.fotoNueva, quita = F.quitarFoto && !F.fotoNueva;
    if (!Object.keys(cambios).length && !hayFoto && !quita) { cerrarFormulario(); return; }
    await VS.encolar({
      tipo: 'editar', id: o.id, cambios: cambios,
      foto: hayFoto ? F.fotoNueva.foto : null, miniatura: hayFoto ? F.fotoNueva.miniatura : '',
      quitarFoto: quita
    });
    cerrarFormulario();
    toast('Cambios guardados.');
  }

  /* ======================================================================
   * Menú
   * ====================================================================== */
  $('btn-menu').addEventListener('click', async () => {
    $('menu-usuario').textContent = 'Sesión de ' + VS.estado.perfil.usuario;
    $('menu-version').textContent = 'Dae lee Shop · versión ' + VS.VERSION;
    $('menu-instalar').hidden = !instalacion;
    const accion = await abrirDialogo($('dlg-menu'));
    if (accion === 'sincronizar') { VS.estado.ultimoError = ''; VS.sincronizar(); }
    else if (accion === 'bloquear') { prepararBloqueo(); mostrar('bloqueo'); }
    else if (accion === 'salir') salirDeEsteTelefono();
    else if (accion === 'instalar' && instalacion) { instalacion.prompt(); instalacion = null; }
  });
  window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); instalacion = ev; });

  /* ======================================================================
   * Arranque
   * ====================================================================== */
  function entrarSegunEstado() {
    const e = VS.estado;
    if (!e.url) { $('campo-enlace').value = ''; mostrar('config'); }
    else if (!e.perfil) { prepararAcceso(); mostrar('acceso'); }
    else { prepararBloqueo(); mostrar('bloqueo'); }
  }

  // Bloquear de nuevo si la aplicación estuvo oculta más de 2 minutos.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { ultimaVezOculta = Date.now(); return; }
    if (pantallaActual === 'app' && ultimaVezOculta && Date.now() - ultimaVezOculta > 120000) {
      prepararBloqueo(); mostrar('bloqueo');
    }
  });

  async function iniciar() {
    construirTeclado();
    $('menu-version').textContent = 'versión ' + VS.VERSION;
    await VS.cargar();
    VS.leerEnlaceDeLaDireccion();
    VS.alCambiar = () => { if (pantallaActual === 'app') render(); };
    entrarSegunEstado();
    VS.iniciarSincronizacionAutomatica();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('Sin trabajo sin conexión:', e));
    }
  }
  iniciar();
})();
