/**
 * Preparar base (botón "🧹 Preparar base" en Campañas Masivas)
 *
 * Recibe el Excel TAL COMO SALE del sistema de Marcimex y hace lo mismo
 * que se hacía a mano antes de cada campaña:
 *   1. Detecta las columnas (nombre, celular, saldo, días, mes, cédula…)
 *   2. Pasa los celulares a formato 593…
 *   3. Excluye: sin celular válido, repetidos, saldo menor al mínimo,
 *      clientes marcados como "no escribir" y quienes ya recibieron
 *      mensaje en los últimos N días
 *   4. Calcula el mes de la cuota más vencida
 *   5. Agrega el número de control al final
 *   6. Devuelve la lista lista para enviar + excluidos con motivo
 *      + los dos archivos Excel para descargar
 *
 * Solo LEE Firestore (cobranza_clientes). No envía ni modifica nada.
 */

const XLSX = require('xlsx');
const { db } = require('../config/firebase');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const COSTO_MENSAJE = 0.0113; // plantilla de Utilidad en Ecuador (USD)

function normalize(str) {
  return String(str).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s_\-]/g, '');
}

function normalizarTelefono(valor) {
  let t = String(valor == null ? '' : valor).trim().replace(/\.0+$/, '').replace(/[^0-9]/g, '');
  if (t.startsWith('00')) t = t.slice(2);
  if (t.length === 10 && t.startsWith('09')) t = '593' + t.slice(1);
  else if (t.length === 9 && t.startsWith('9')) t = '593' + t; // Excel quitó el 0 inicial
  return t;
}
const celularValido = (t) => /^5939\d{8}$/.test(t);

function normalizarCedula(valor) {
  let t = String(valor == null ? '' : valor).trim().replace(/\.0+$/, '').replace(/[^0-9]/g, '');
  if (t.length === 9 || t.length === 12) t = '0' + t;
  return t;
}

// 120.5 · "120,50" · "$120.50" · "1.234,56" · "1,234.56"
function parseMonto(valor) {
  if (typeof valor === 'number') return isFinite(valor) ? valor : 0;
  let s = String(valor == null ? '' : valor).replace(/[^0-9.,-]/g, '');
  if (!s) return 0;
  const coma = s.lastIndexOf(','), punto = s.lastIndexOf('.');
  if (coma > -1 && punto > -1) {
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma > -1) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

const limpiarTexto = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

// Mes de la cuota: número (10), texto ("octubre"), fecha de Excel o "07/10/2026"
function mesDe(valor) {
  if (valor == null || valor === '') return '';
  if (typeof valor === 'number') {
    if (valor >= 1 && valor <= 12) return MESES[Math.round(valor) - 1];
    if (valor > 20000) { // número de serie de fecha de Excel
      const d = XLSX.SSF.parse_date_code(valor);
      return d ? MESES[d.m - 1] : '';
    }
    return '';
  }
  if (valor instanceof Date) return MESES[valor.getMonth()];
  const s = String(valor).trim().toLowerCase();
  const porNombre = MESES.find(m => s.startsWith(m.slice(0, 3)));
  if (porNombre && /^[a-záéíóú]/.test(s)) return porNombre;
  const f = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); // dd/mm/aaaa
  if (f) { const m = parseInt(f[2], 10); return m >= 1 && m <= 12 ? MESES[m - 1] : ''; }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) { const m = parseInt(iso[2], 10); return m >= 1 && m <= 12 ? MESES[m - 1] : ''; }
  const n = parseInt(s, 10);
  return n >= 1 && n <= 12 ? MESES[n - 1] : '';
}

// Elige la hoja que tenga columna de nombre y de celular (la base puede venir en "Hoja2")
function elegirHoja(wb) {
  for (const nombre of wb.SheetNames) {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { defval: '' });
    if (!filas.length) continue;
    const claves = Object.keys(filas[0]).map(normalize);
    const tieneNombre = claves.some(k => k.includes('nombre'));
    const tieneCel = claves.some(k => k.includes('celular') || k.includes('telefono') || k.includes('numero'));
    if (tieneNombre && tieneCel) return filas;
  }
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

// ════════════════════════════════════════════════════════════════
// Formato "Detalle por Clientes" (un renglón por CRÉDITO):
// se agrupan los créditos de cada cliente y se calcula el rodamiento
// con las MISMAS fórmulas del Listado de Ventas / Listado Rodamiento.
// ════════════════════════════════════════════════════════════════
const RANK_CAL = { AA: 0, A: 1, B: 2, C: 3, D: 4, E: 5, E1: 6, E2: 7 };
const normCalif = v => (v === null || v === undefined) ? '' : String(v).trim().toUpperCase().replace(/\s+/g, '');

// Fecha de corte: último día del mes actual (hora de Ecuador, UTC-5)
function fechaCorteUTC() {
  const ec = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return Date.UTC(ec.getUTCFullYear(), ec.getUTCMonth() + 1, 0);
}
function parseFecha(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && isFinite(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return isNaN(d) ? null : d;
  }
  if (v instanceof Date) return isNaN(v) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let day = +m[1], mon = +m[2], y = +m[3]; if (y < 100) y += 2000;
    if (day <= 12 && mon > 12) { const t = day; day = mon; mon = t; }
    return new Date(Date.UTC(y, mon - 1, day));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}
function diasHoy(d, corte) {
  if (!d) return '';
  return Math.floor((corte - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 86400000);
}
function califRealAfectacion(dias) {
  if (dias === '' || dias === null || dias === undefined) return '';
  const n = Number(dias);
  if (isNaN(n) || n <= 0) return 'AA';
  if (n <= 30) return 'A';
  if (n <= 60) return 'B';
  if (n <= 90) return 'C';
  if (n <= 120) return 'D';
  if (n <= 150) return 'E';
  if (n <= 180) return 'E1';
  return 'E2';
}
function categoriaRodamiento(inicial, rod) {
  const a = normCalif(inicial), b = normCalif(rod);
  if (!a || !b || !(a in RANK_CAL) || !(b in RANK_CAL)) return 'Sin Clasificar';
  if (RANK_CAL[b] === RANK_CAL[a]) return 'Mantiene';
  if (RANK_CAL[b] > RANK_CAL[a]) return 'Deteriora';
  return 'Mejora';
}
// Regla del Listado de Ventas: si la mensual es AA se mide con la diaria
function categoriaRodamientoVentas(mensual, diaria, rod) {
  const m = normCalif(mensual), d = normCalif(diaria);
  if (m === 'AA') {
    if (!d || !(d in RANK_CAL)) return 'Sin Clasificar';
    return d === 'AA' ? 'Mejora' : 'Deteriora';
  }
  return categoriaRodamiento(mensual, rod);
}
const txt = v => (v === null || v === undefined) ? '' : String(v).trim();
function distintos(rows, fn) {
  const s = []; rows.forEach(r => { const v = fn(r); if (v && !s.includes(v)) s.push(v); }); return s.join(' | ');
}

// ¿El archivo viene por crédito? (tiene Cod Cliente + Fecha Vencimiento Final + Saldo Cuota)
function esFormatoCreditos(keys) {
  const k = keys.map(normalize);
  return k.includes(normalize('Cod Cliente')) && k.includes(normalize('Fecha Vencimiento Final')) && k.includes(normalize('Saldo Cuota'));
}

// Convierte los créditos en una fila por cliente con los nombres de columna
// del Listado de Ventas (los mismos que ya entiende "Preparar base")
function agruparCreditos(raw) {
  const keys = Object.keys(raw[0]);
  const k = (...c) => { for (const x of c) { const f = keys.find(y => normalize(y) === normalize(x)); if (f) return f; } return null; };
  const C = {
    id: k('Cod Cliente'), nombre: k('Nombre Cliente', 'Nombre del Cliente'), ced: k('Nro Identificación', 'Número de Identificación'),
    dir: k('Dirección Principal'), tel: k('Telefono Celular', 'Teléfono Celular'), zona: k('Zona Cliente Final'),
    cob: k('Nombre Cobrador Actual'), calM: k('Calificación Cliente Mensual'), calD: k('Calificación Cliente Diaria'),
    fIni: k('Fecha Vencimiento Inicial'), fFin: k('Fecha Vencimiento Final'), saldoCuota: k('Saldo Cuota'),
    saldoCred: k('Saldo Crédito Final'), valorCuota: k('Valor Cuota'), tifac: k('Tienda Factura'), ven: k('Nombre Vendedor')
  };
  const corte = fechaCorteUTC();
  const clientes = {};
  raw.forEach(r => {
    const id = r[C.id];
    if (!id || String(id).trim() === '' || String(id).toLowerCase() === 'total') return;
    if (!clientes[id]) {
      clientes[id] = { r0: r, cal_m: normCalif(r[C.calM]), cal_d: normCalif(r[C.calD]), min_fecha: null, min_ini: null, rows: [] };
    }
    const c = clientes[id];
    const fv = parseFecha(r[C.fFin]); if (fv && (!c.min_fecha || fv < c.min_fecha)) c.min_fecha = fv;
    const fi = C.fIni ? parseFecha(r[C.fIni]) : null; if (fi && (!c.min_ini || fi < c.min_ini)) c.min_ini = fi;
    c.rows.push(r);
  });
  const dmy = d => d ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` : '';
  return Object.values(clientes).map(c => {
    let sumaCuota = 0, sumaSaldo = 0, sumaValor = 0;
    c.rows.forEach(r => {
      const fv = parseFecha(r[C.fFin]);
      if (fv && c.min_fecha && fv <= c.min_fecha) sumaCuota += (parseFloat(r[C.saldoCuota]) || 0);
      if (C.saldoCred) sumaSaldo += (parseFloat(r[C.saldoCred]) || 0);
      if (C.valorCuota) sumaValor += (parseFloat(r[C.valorCuota]) || 0);
    });
    const hoy = diasHoy(c.min_fecha, corte);
    const calRod = califRealAfectacion(hoy);
    const ord = [...c.rows].sort((a, b) => {
      const fa = parseFecha(a[C.fFin]), fb = parseFecha(b[C.fFin]);
      return (fa ? fa.getTime() : Infinity) - (fb ? fb.getTime() : Infinity);
    });
    const r0 = c.r0;
    return {
      'Nombre del Cliente': txt(r0[C.nombre]),
      'Número de Identificación': C.ced ? r0[C.ced] : '',
      'Dirección Principal': C.dir ? txt(r0[C.dir]) : '',
      'Teléfono Celular': C.tel ? r0[C.tel] : '',
      'Zona del Cliente Final': C.zona ? txt(r0[C.zona]) : '',
      'Nombre del Cobrador Actual': C.cob ? txt(r0[C.cob]) : '',
      'Calificación Cliente Mensual': c.cal_m,
      'Calificación Cliente Diaria': c.cal_d,
      'HOY': hoy,
      'Calificación Real Afectación': calRod,
      'Fecha de Vencimiento Inicial': dmy(c.min_ini),
      'Fecha de Vencimiento Final Más Antigua': dmy(c.min_fecha),
      'Mes Venc. Final': c.min_fecha ? c.min_fecha.getUTCMonth() + 1 : '',
      'Suma Saldo Cuota (Fecha Antigua)': +sumaCuota.toFixed(2),
      'Suma Saldo Crédito Final Total': +sumaSaldo.toFixed(2),
      'Suma Valor Cuota Total': +sumaValor.toFixed(2),
      'Categoría Cliente Rodamiento': categoriaRodamientoVentas(c.cal_m, c.cal_d, calRod),
      'Tienda Factura': C.tifac ? distintos(ord, r => txt(r[C.tifac])) : '',
      'Nombre Vendedor': C.ven ? distintos(ord, r => txt(r[C.ven])) : ''
    };
  });
}

function aExcelBase64(filas, hoja) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas.length ? filas : [{ Nota: 'Sin registros' }]), hoja);
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

exports.prepararBase = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.data) return res.status(400).json({ ok: false, error: 'No se recibió archivo.' });

    const op = body.opciones || {};
    const saldoMinimo = Math.max(0, Number(op.saldoMinimo ?? 1) || 0);
    const diasSinRepetir = Math.max(0, parseInt(op.diasSinRepetir ?? 3, 10) || 0);
    const controlTel = op.controlTelefono ? normalizarTelefono(op.controlTelefono) : '';
    const controlNombre = limpiarTexto(op.controlNombre || 'CONTROL');

    const wb = XLSX.read(Buffer.from(body.data, 'base64'), { type: 'buffer', cellDates: false });
    let raw = elegirHoja(wb);
    if (!raw.length) return res.status(400).json({ ok: false, error: 'El archivo está vacío.' });

    // Si viene por crédito ("Detalle por Clientes"), se agrupa por cliente y se calcula el rodamiento
    let formato = 'clientes', creditos = 0;
    if (esFormatoCreditos(Object.keys(raw[0]))) {
      creditos = raw.length;
      raw = agruparCreditos(raw);
      formato = 'creditos';
      if (!raw.length) return res.status(400).json({ ok: false, error: 'No se encontraron clientes (columna "Cod Cliente" vacía).' });
    }

    const keys = Object.keys(raw[0]);
    const find = (...cands) => {
      for (const c of cands) {
        const k = keys.find(x => normalize(x) === normalize(c));
        if (k) return k;
      }
      return null;
    };

    const col = {
      nombre:   find('Nombre del Cliente', 'Nombre', 'Cliente'),
      tel:      find('Teléfono Celular', 'Telefono Celular', 'Celular', 'Telefono', 'Teléfono', 'Numero', 'Número'),
      deuda:    find('Suma Saldo Cuota (Fecha Antigua)', 'Saldo Cuota', 'Suma Saldo Cuota desde Fecha Antigua', 'Deuda', 'Saldo'),
      dias:     find('HOY', 'Dias', 'Días', 'Dias vencidos', 'Días vencidos', 'DIAS VENCIDOS', 'Dias Mora', 'Días Mora'),
      mesNum:   find('Mes Venc. Final', 'Mes Venc Final', 'Mes'),
      fechaVen: find('Fecha de Vencimiento Final Más Antigua', 'Fecha de Vencimiento Final Mas Antigua', 'Fecha de Vencimiento Inicial'),
      cedula:   find('Número de Identificación', 'Numero de Identificacion', 'Cedula', 'Cédula', 'Identificación', 'Identificacion'),
      cobrador: find('Nombre del Cobrador Actual', 'Cobrador'),
      tienda:   find('Tienda Factura', 'Tienda'),
      vendedor: find('Nombre Vendedor', 'Vendedor'),
      calMes:   find('Calificación Cliente Mensual', 'Calificacion Mensual', 'Calificación Mensual'),
      calRod:   find('Calificación Real Afectación', 'Calificacion Rodamiento', 'Calificación Rodamiento'),
      rodam:    find('Categoría Cliente Rodamiento', 'Rodamiento'),
      saldoTot: find('Suma Saldo Crédito Final Total', 'Saldo Total', 'Saldo Credito Total')
    };
    if (!col.nombre || !col.tel) {
      return res.status(400).json({ ok: false, error: `No se encontraron las columnas de nombre y celular. Columnas del archivo: ${keys.join(', ')}` });
    }
    if (!col.deuda) {
      return res.status(400).json({ ok: false, error: 'No se encontró la columna del saldo (por ejemplo "Suma Saldo Cuota (Fecha Antigua)" o "Deuda").' });
    }

    // 1) Leer y normalizar cada fila
    const filas = raw.map(r => {
      const tel = normalizarTelefono(r[col.tel]);
      const mes = mesDe(col.mesNum ? r[col.mesNum] : '') || mesDe(col.fechaVen ? r[col.fechaVen] : '');
      return {
        nombre: limpiarTexto(r[col.nombre]),
        numero: tel,
        telOriginal: limpiarTexto(r[col.tel]),
        deuda: Math.round(parseMonto(r[col.deuda]) * 100) / 100,
        dias: col.dias ? (parseInt(String(r[col.dias]).replace(/[^0-9-]/g, ''), 10) || 0) : 0,
        mes,
        cedula: col.cedula ? normalizarCedula(r[col.cedula]) : '',
        cobrador: col.cobrador ? limpiarTexto(r[col.cobrador]) : '',
        tienda: col.tienda ? limpiarTexto(r[col.tienda]) : '',
        vendedor: col.vendedor ? limpiarTexto(r[col.vendedor]) : '',
        calMensual: col.calMes ? limpiarTexto(r[col.calMes]).toUpperCase() : '',
        calRodamiento: col.calRod ? limpiarTexto(r[col.calRod]).toUpperCase() : '',
        rodamiento: col.rodam ? limpiarTexto(r[col.rodam]) : '',
        saldoTotal: col.saldoTot ? Math.round(parseMonto(r[col.saldoTot]) * 100) / 100 : 0
      };
    }).filter(f => f.nombre);

    // 2) Historial de envíos y exclusiones (solo lectura)
    const unicos = [...new Set(filas.map(f => f.numero).filter(celularValido))];
    const historial = {};
    for (let i = 0; i < unicos.length; i += 300) {
      const snaps = await db.getAll(...unicos.slice(i, i + 300).map(t => db.collection('cobranza_clientes').doc(t)));
      snaps.forEach(s => { if (s.exists) historial[s.id] = s.data(); });
    }
    const limiteMs = Date.now() - diasSinRepetir * 24 * 60 * 60 * 1000;

    // 3) Reglas de exclusión
    const listos = [], excluidos = [], vistos = new Set();
    for (const f of filas) {
      let motivo = '';
      const h = historial[f.numero];
      if (!celularValido(f.numero)) motivo = 'Sin celular válido';
      else if (vistos.has(f.numero)) motivo = 'Celular repetido';
      else if (h && h.excluido) motivo = 'Pidió no recibir mensajes / número equivocado';
      else if (f.deuda < saldoMinimo) motivo = `Saldo menor a $${saldoMinimo.toFixed(2)}`;
      else if (col.dias && f.dias <= 0) motivo = 'Sin atraso (la cuota aún no vence)';
      else if (diasSinRepetir > 0 && h && h.fecha && Date.parse(h.fecha) >= limiteMs) {
        motivo = `Ya recibió mensaje el ${new Date(h.fecha).toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil' })}`;
      }
      if (motivo) excluidos.push({ ...f, motivo });
      else { vistos.add(f.numero); listos.push(f); }
    }

    // 4) Orden: más días de atraso primero
    listos.sort((a, b) => (b.dias - a.dias) || a.nombre.localeCompare(b.nombre, 'es'));

    // 5) Número de control al final (para confirmar que la campaña terminó)
    if (controlTel && celularValido(controlTel)) {
      const yaEsta = listos.findIndex(c => c.numero === controlTel);
      if (yaEsta >= 0) listos.splice(yaEsta, 1);
      const conteoMes = {};
      listos.forEach(c => { if (c.mes) conteoMes[c.mes] = (conteoMes[c.mes] || 0) + 1; });
      const mesComun = Object.keys(conteoMes).sort((a, b) => conteoMes[b] - conteoMes[a])[0] || MESES[new Date().getMonth()];
      listos.push({ nombre: controlNombre, numero: controlTel, deuda: 10, dias: 19, mes: mesComun, cedula: '', cobrador: '', tienda: '', vendedor: '', calMensual: '', calRodamiento: '', rodamiento: '', saldoTotal: 0, control: true });
    }

    // 6) Formato igual al de "parse" para seguir con los pasos normales
    const clients = listos.map((c, i) => ({
      id: i + 1, nombre: c.nombre, numero: c.numero, deuda: c.deuda, dias: c.dias,
      mensajePre: '', cobrador: c.cobrador, tienda: c.tienda, categoria: '', mes: c.mes,
      cedula: c.cedula, vendedor: c.vendedor, calMensual: c.calMensual,
      calRodamiento: c.calRodamiento, rodamiento: c.rodamiento, saldoTotal: c.saldoTotal
    }));

    const stats = {
      total: clients.length,
      alto: clients.filter(c => c.dias >= 90).length,
      medio: clients.filter(c => c.dias >= 30 && c.dias < 90).length,
      bajo: clients.filter(c => c.dias < 30).length,
      deudaTotal: Math.round(listos.filter(c => !c.control).reduce((s, c) => s + c.deuda, 0) * 100) / 100,
      cobradores: [...new Set(clients.map(c => c.cobrador).filter(Boolean))]
    };

    const motivos = {};
    excluidos.forEach(e => { motivos[e.motivo.startsWith('Ya recibió') ? 'Ya recibió mensaje hace poco' : e.motivo] = (motivos[e.motivo.startsWith('Ya recibió') ? 'Ya recibió mensaje hace poco' : e.motivo] || 0) + 1; });
    const porMes = {};
    listos.filter(c => !c.control).forEach(c => { const m = c.mes || 'sin mes'; porMes[m] = (porMes[m] || 0) + 1; });

    const filaExcel = c => ({
      Nombre: c.nombre, Telefono: c.numero, Mes: c.mes, Deuda: c.deuda, Dias: c.dias, Cobrador: c.cobrador,
      Cedula: c.cedula, 'Nombre Vendedor': c.vendedor, 'Tienda Factura': c.tienda,
      'Calificación Cliente Mensual': c.calMensual, 'Calificación Real Afectación': c.calRodamiento,
      'Categoría Cliente Rodamiento': c.rodamiento, 'Suma Saldo Crédito Final Total': c.saldoTotal
    });

    res.json({
      ok: true,
      clients, stats,
      resumen: {
        filasArchivo: raw.length,
        formato, creditos,
        listos: clients.length,
        excluidos: excluidos.length,
        motivos, porMes,
        control: !!(controlTel && celularValido(controlTel)),
        costoAprox: Math.round(clients.length * COSTO_MENSAJE * 100) / 100,
        diasSinRepetir, saldoMinimo,
        columnaSaldo: col.deuda, columnaDias: col.dias || '(no encontrada)'
      },
      excluidos: excluidos.map(e => ({ nombre: e.nombre, telefono: e.telOriginal, deuda: e.deuda, dias: e.dias, cobrador: e.cobrador, motivo: e.motivo })),
      archivos: {
        base: aExcelBase64(listos.map(filaExcel), 'Base para enviar'),
        excluidos: aExcelBase64(excluidos.map(e => ({ Nombre: e.nombre, 'Teléfono original': e.telOriginal, Deuda: e.deuda, Dias: e.dias, Cobrador: e.cobrador, Motivo: e.motivo })), 'Excluidos')
      }
    });
  } catch (err) {
    console.error('Error preparando base:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
