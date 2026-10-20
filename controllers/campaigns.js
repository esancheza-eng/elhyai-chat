/**
 * Campaign Controller
 * Lógica de negocio para campañas masivas
 */

const XLSX = require('xlsx');
const wa   = require('../services/whatsapp');
const { db } = require('../config/firebase');

// Estado en memoria del job activo
// En producción usar Redis o DB
let activeJob = {
  id:       null,
  running:  false,
  paused:   false,
  total:    0,
  sent:     0,
  failed:   0,
  skipped:  0,
  current:  '',
  log:      [],
  startedAt: null,
  finishedAt: null,
  campaignName: '',
};

// ── GUARDADO EN FIRESTORE (colección "campanas") ──────────
// Permite ver el avance y continuar la campaña si Render se reinicia.
let colaGuardado = Promise.resolve();
function limpio(obj) { return JSON.parse(JSON.stringify(obj)); } // Firestore no acepta undefined

function guardarCampana(extra = {}) {
  if (!activeJob.id) return colaGuardado;
  const id = activeJob.id;
  const data = limpio({ ...activeJob, ...extra, actualizado: new Date().toISOString() });
  colaGuardado = colaGuardado
    .then(() => db.collection('campanas').doc(id).set(data, { merge: true }))
    .catch(e => console.error('No se pudo guardar la campaña en Firestore:', e.message));
  return colaGuardado;
}

let timerEstados = null;
function guardarCampanaPronto() {
  clearTimeout(timerEstados);
  timerEstados = setTimeout(() => guardarCampana(), 2000);
}

// ── PARSEAR EXCEL ─────────────────────────────────────────
exports.parseExcel = (req, res) => {
  try {
    if (!req.body.data) return res.status(400).json({ ok: false, error: 'No se recibió archivo.' });

    const buf = Buffer.from(req.body.data, 'base64');
    const wb  = XLSX.read(buf, { type: 'buffer' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!raw.length) return res.status(400).json({ ok: false, error: 'El archivo está vacío.' });

    const keys = Object.keys(raw[0]);
    const find = (...candidates) => {
      for (const c of candidates) {
        const found = keys.find(k =>
          normalize(k) === normalize(c)
        );
        if (found) return found;
      }
      return null;
    };

    // Detectar columnas flexiblemente
    const colNombre   = find('Nombre del Cliente','Nombre','nombre','name','NOMBRE','cliente');
    const colNumero   = find('Teléfono Celular','Telefono Celular','Número','numero','telefono','celular','phone','TELEFONO','TEL');
    const colDeuda    = find('Saldo Crédito Final Total','Saldo Credito Final Total','Suma Saldo Cuota desde Fecha Antigua','Deuda','deuda','saldo','monto','SALDO','DEUDA');
    const colDias     = find('DIAS VENCIDOS','Días vencidos','dias vencidos','dias','vencidos','DIAS','DíasVencidos','dias_mora','DIAS_MORA','Días Mora','Dias Mora');
    const colMensaje  = find('MENSAJE','Mensaje','mensaje','MESSAGE');
    const colCobrador = find('Nombre del Cobrador Actual','Cobrador','cobrador','COBRADOR');
    const colTienda   = find('Tienda Factura','Tienda','tienda','TIENDA');
    const colCategoria= find('Categoría Cliente','Categoria','categoria','CATEGORIA');
    const colMes      = find('Mes','MES','Mes vencido','Mes Vencido','Mes de la cuota');
    const colVendedor = find('Nombre Vendedor','Vendedor','VENDEDOR');
    const colCalMes   = find('Calificación Cliente Mensual','Calificacion Mensual','Calificación Mensual');
    const colCalRod   = find('Calificación Real Afectación','Calificacion Rodamiento','Calificación Rodamiento','Calificacion Real Afectacion');
    const colRodam    = find('Categoría Cliente Rodamiento','Rodamiento','Categoria Rodamiento');
    const colSaldoTot = find('Suma Saldo Crédito Final Total','Saldo Total','Saldo Credito Total','Saldo Total Credito');
    const colCedula   = find('Cedula','Cédula','CEDULA','Número de Identificación','Numero de Identificacion','Identificación','Identificacion','CI','C.I.');

    if (!colNombre || !colNumero) {
      return res.status(400).json({
        ok: false,
        error: `No se encontraron columnas de Nombre y Número. Columnas disponibles: ${keys.join(', ')}`
      });
    }

    // Parsear clientes
    const clients = raw.map((row, i) => {
      const nombre   = String(row[colNombre] || '').trim();
      const numero   = normalizarTelefono(row[colNumero]);
      const deuda    = parseMonto(row[colDeuda]);
      const dias     = parseInt(String(row[colDias]     || '0').replace(/[^0-9]/g,''))  || 0;
      const mensajePre = colMensaje  ? String(row[colMensaje]  || '').trim() : '';
      const cobrador   = colCobrador ? String(row[colCobrador] || '').trim() : '';
      const tienda     = colTienda   ? String(row[colTienda]   || '').trim() : '';
      const categoria  = colCategoria? String(row[colCategoria]|| '').trim() : '';
      const mes        = colMes      ? String(row[colMes]      || '').trim().toLowerCase() : '';
      const cedula     = colCedula   ? normalizarCedula(row[colCedula]) : '';
      const txt = (col) => col ? String(row[col] == null ? '' : row[col]).trim() : '';
      const vendedor   = txt(colVendedor);
      const calMensual = txt(colCalMes).toUpperCase();
      const calRodamiento = txt(colCalRod).toUpperCase();
      const rodamiento = txt(colRodam);
      const saldoTotal = colSaldoTot ? parseMonto(row[colSaldoTot]) : 0;

      return { id: i + 1, nombre, numero, deuda, dias, mensajePre, cobrador, tienda, categoria, mes, cedula, vendedor, calMensual, calRodamiento, rodamiento, saldoTotal };
    }).filter(c => c.nombre && c.numero && c.numero.length >= 7);

    // Estadísticas
    const stats = {
      total:  clients.length,
      alto:   clients.filter(c => c.dias >= 90).length,
      medio:  clients.filter(c => c.dias >= 30 && c.dias < 90).length,
      bajo:   clients.filter(c => c.dias < 30).length,
      deudaTotal: clients.reduce((s, c) => s + c.deuda, 0),
      cobradores: [...new Set(clients.map(c => c.cobrador).filter(Boolean))],
    };

    res.json({ ok: true, clients, stats, columns: keys });
  } catch (err) {
    console.error('parseExcel error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ── INICIAR CAMPAÑA MASIVA ────────────────────────────────
exports.startCampaign = async (req, res) => {
  try {
    wa.checkCredentials();

    if (activeJob.running) {
      return res.status(409).json({ ok: false, error: 'Ya hay una campaña en curso. Detén la actual primero.' });
    }
    if (restaurando) {
      return res.status(409).json({ ok: false, error: 'El servidor está iniciando, intenta de nuevo en unos segundos.' });
    }

    const {
      clients,
      template,         // texto con variables {nombre} {deuda} etc.
      useTemplate,      // true = plantilla Meta | false = texto libre
      templateName,     // nombre de plantilla aprobada en Meta
      templateLang,     // código de idioma, ej: 'es'
      delay = 10000,    // ms entre mensajes
      // ── Opcionales (plantillas de marketing). Si no se envían, todo funciona como antes ──
      templateVars,     // ej. ["nombre", "\"Milagro\""]  → {{1}}, {{2}}…  ([] = sin variables)
      headerType,       // 'image' | 'video' | 'document'
      headerUrl,        // enlace público https:// del archivo del encabezado
      buttonParam,      // valor para un botón con enlace dinámico (termina en {{1}})
      campaignName = 'Campaña ' + new Date().toLocaleDateString('es-EC'),
    } = req.body;

    if (!clients || !clients.length) {
      return res.status(400).json({ ok: false, error: 'Sin clientes para enviar.' });
    }

    // Validar opciones avanzadas (solo si se usan)
    if (templateVars !== undefined && templateVars !== null) {
      if (!Array.isArray(templateVars)) {
        return res.status(400).json({ ok: false, error: 'templateVars debe ser una lista.' });
      }
      const malos = templateVars.filter(v => !esCampoValido(v));
      if (malos.length) {
        return res.status(400).json({ ok: false, error: `Variables no reconocidas: ${malos.join(', ')}. Usa: ${CAMPOS_VARIABLES.join(', ')} o texto fijo entre comillas.` });
      }
    }
    if (headerType && !['image', 'video', 'document'].includes(headerType)) {
      return res.status(400).json({ ok: false, error: 'Tipo de encabezado inválido.' });
    }
    if (headerType && !/^https:\/\/\S+$/i.test(String(headerUrl || ''))) {
      return res.status(400).json({ ok: false, error: 'El encabezado necesita un enlace público que empiece con https://' });
    }
    if (buttonParam !== undefined && buttonParam !== null && buttonParam !== '' && !esCampoValido(buttonParam)) {
      return res.status(400).json({ ok: false, error: `Valor del botón no reconocido: ${buttonParam}` });
    }

    // Reset job
    activeJob = {
      id:           Date.now().toString(),
      running:      true,
      paused:       false,
      total:        clients.length,
      sent:         0,
      failed:       0,
      skipped:      0,
      current:      '',
      log:          [],
      startedAt:    new Date().toISOString(),
      finishedAt:   null,
      campaignName,
    };

    // Configuración del envío (se guarda para poder continuar tras un reinicio)
    const cfg = { template, useTemplate, templateName, templateLang, delay, templateVars, headerType, headerUrl, buttonParam };

    // Guardar la campaña completa en Firestore (clientes solo si caben en un documento)
    const clientesJson = JSON.stringify(clients);
    const guardarClientes = clientesJson.length < 800000;
    if (!guardarClientes) console.warn('Campaña muy grande: no se guardan los clientes, no podrá continuar tras un reinicio.');
    guardarCampana({ cfg: limpio(cfg), siguiente: 0, ...(guardarClientes ? { clients: JSON.parse(clientesJson) } : {}) });

    // Responder inmediatamente
    res.json({ ok: true, jobId: activeJob.id, message: `Iniciando campaña "${campaignName}" con ${clients.length} clientes.` });

    // Envío asíncrono
    ejecutarEnvio(cfg, clients, 0);

  } catch (err) {
    activeJob.running = false;
    console.error('startCampaign error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ── BUCLE DE ENVÍO (desde un índice, para poder continuar) ─
function ejecutarEnvio(cfg, clients, desde) {
  const { template, useTemplate, templateName, templateLang, delay = 10000, templateVars, headerType, headerUrl, buttonParam } = cfg;
    (async () => {
      for (let i = desde; i < clients.length; i++) {
        // Control de pausa
        while (activeJob.paused && activeJob.running) {
          await wa.sleep(1000);
        }
        if (!activeJob.running) break;

        const c = clients[i];
        activeJob.current = c.nombre;

        // No escribir a quien pidió no recibir mensajes o dijo "número equivocado"
        try {
          const ex = await db.collection('cobranza_clientes').doc(String(c.numero)).get();
          if (ex.exists && ex.data().excluido) {
            activeJob.skipped++;
            activeJob.log.push({
              id: c.id, nombre: c.nombre, numero: c.numero, deuda: c.deuda, dias: c.dias,
              status: 'omitido',
              error: ex.data().motivoExclusion === 'equivocado' ? 'Omitido: número equivocado' : 'Omitido: pidió no recibir mensajes',
              ts: new Date().toLocaleTimeString('es-EC'),
            });
            await guardarCampana({ siguiente: i + 1 });
            continue;
          }
        } catch (e) { /* si falla la consulta, se envía normal */ }

        try {
          let result;

          if (useTemplate && templateName) {
            // Plantilla aprobada Meta — variables dinámicas
            const deudaFmt = c.deuda.toLocaleString('es-EC', { minimumFractionDigits: 2 });
            // Sin opciones avanzadas: igual que siempre ({{1}} nombre, {{2}} deuda, {{3}} días)
            const variables = Array.isArray(templateVars)
              ? templateVars.map(v => valorCampo(v, c))
              : [c.nombre, deudaFmt, String(c.dias)];
            const components = wa.buildTemplateComponents(variables);

            // Encabezado con imagen / video / documento (opcional)
            if (headerType && headerUrl) {
              const media = { link: headerUrl };
              if (headerType === 'document') media.filename = (headerUrl.split('/').pop() || 'documento.pdf').split('?')[0];
              components.unshift({ type: 'header', parameters: [{ type: headerType, [headerType]: media }] });
            }

            // Botón con enlace dinámico (opcional)
            if (buttonParam) {
              components.push({
                type: 'button', sub_type: 'url', index: '0',
                parameters: [{ type: 'text', text: valorCampo(buttonParam, c) }]
              });
            }

            result = await wa.sendTemplateMessage(c.numero, templateName, templateLang || 'es', components);
          } else {
            // Texto libre personalizado
            const mensaje = buildMessage(template, c);
            result = await wa.sendTextMessage(c.numero, mensaje);
          }

          activeJob.sent++;

          // Guardar los datos que recibió el cliente (los usa el bot de cobranza para "consultar saldo")
          try {
            const mesVar = Array.isArray(templateVars)
              ? templateVars.map(v => String(v).trim()).find(v => /^["'“”].*["'“”]$/.test(v) && MESES_TXT.includes(v.slice(1, -1).toLowerCase().trim()))
              : null;
            await db.collection('cobranza_clientes').doc(String(c.numero)).set(limpio({
              nombre: c.nombre, deuda: c.deuda, dias: c.dias,
              cobrador: c.cobrador || '', tienda: c.tienda || '',
              ...datosFicha(c),
              mes: c.mes ? String(c.mes).toLowerCase().trim() : (mesVar ? mesVar.slice(1, -1).toLowerCase().trim() : null),
              campana: activeJob.campaignName, campanaId: activeJob.id,
              plantilla: useTemplate ? templateName : null,
              fecha: new Date().toISOString()
            }), { merge: true });
          } catch (e) { console.error('No se pudo guardar cobranza_clientes:', e.message); }
          activeJob.log.push({
            id:      c.id,
            nombre:  c.nombre,
            numero:  c.numero,
            deuda:   c.deuda,
            dias:    c.dias,
            status:  'ok',
            msgId:   result?.messages?.[0]?.id || '',
            ts:      new Date().toLocaleTimeString('es-EC'),
          });
          console.log(`✅ [${activeJob.sent}/${activeJob.total}] ${c.nombre} (${c.numero})`);

        } catch (err) {
          activeJob.failed++;
          const errMsg = err.response?.data?.error?.message || err.message;
          activeJob.log.push({
            id:     c.id,
            nombre: c.nombre,
            numero: c.numero,
            deuda:  c.deuda,
            dias:   c.dias,
            status: 'error',
            error:  errMsg,
            ts:     new Date().toLocaleTimeString('es-EC'),
          });
          console.error(`❌ [${i+1}/${activeJob.total}] ${c.nombre}: ${errMsg}`);
        }

        // Guardar avance: si Render se reinicia, se continúa desde el siguiente cliente
        await guardarCampana({ siguiente: i + 1 });

        // Delay entre mensajes (saltar en el último)
        if (i < clients.length - 1 && activeJob.running) {
          await wa.sleep(delay);
        }
      }

      activeJob.running    = false;
      activeJob.finishedAt = new Date().toISOString();
      activeJob.current    = '';
      await guardarCampana();
      console.log(`\n🎉 Campaña finalizada. Enviados: ${activeJob.sent} | Fallidos: ${activeJob.failed}`);
    })();
}

// ── AL ARRANCAR: recuperar la última campaña ──────────────
// Si quedó a medias por un reinicio de Render, continúa desde donde iba.
let restaurando = true; // mientras se revisa Firestore al arrancar
async function restaurarCampana() {
  try {
    const snap = await db.collection('campanas').orderBy('startedAt', 'desc').limit(1).get();
    // Si ya se inició una campaña en este arranque, no tocar nada (evita envíos duplicados)
    if (activeJob.id || !snap.docs.length) return;
    const d = snap.docs[0].data();
    const { cfg, clients, siguiente = 0, actualizado, ...job } = d;
    activeJob = { ...activeJob, ...job, log: job.log || [] };

    const aMedias = job.running && !job.finishedAt;
    if (!aMedias) return; // terminada: solo se muestra el resultado

    if (!cfg || !Array.isArray(clients) || siguiente >= clients.length) {
      activeJob.running = false;
      activeJob.finishedAt = activeJob.finishedAt || new Date().toISOString();
      activeJob.current = '';
      await guardarCampana();
      return;
    }
    wa.checkCredentials();
    console.log(`🔄 Continuando campaña "${activeJob.campaignName}" desde el cliente ${siguiente + 1} de ${clients.length}`);
    ejecutarEnvio(cfg, clients, siguiente);
  } catch (e) {
    console.error('No se pudo restaurar la campaña:', e.message);
  } finally {
    restaurando = false;
  }
}
restaurarCampana();

// ── CONTROLES ─────────────────────────────────────────────
exports.pauseCampaign = (req, res) => {
  activeJob.paused = true;
  guardarCampana();
  res.json({ ok: true, message: 'Campaña pausada.' });
};

exports.resumeCampaign = (req, res) => {
  activeJob.paused = false;
  guardarCampana();
  res.json({ ok: true, message: 'Campaña reanudada.' });
};

exports.stopCampaign = (req, res) => {
  activeJob.running = false;
  activeJob.paused  = false;
  guardarCampana();
  res.json({ ok: true, message: 'Campaña detenida.' });
};

// ── STATUS ────────────────────────────────────────────────
exports.getStatus = (req, res) => {
  const pct = activeJob.total
    ? Math.round(((activeJob.sent + activeJob.failed) / activeJob.total) * 100)
    : 0;
  res.json({ ...activeJob, pct });
};

// ── ESTADOS DE ENTREGA (llegan después por el webhook) ────
// status: sent | delivered | read | failed
const ORDEN_ESTADO = { sent: 1, delivered: 2, read: 3, failed: 4 };
exports.registrarEstado = (msgId, status, errorTexto) => {
  if (!msgId) return false;
  const entrada = activeJob.log.find(l => l.msgId === msgId);
  if (!entrada) return false;
  // No retroceder (ej. un "delivered" que llega después de "read")
  if ((ORDEN_ESTADO[status] || 0) < (ORDEN_ESTADO[entrada.entrega] || 0)) return true;
  entrada.entrega = status;
  if (errorTexto) entrada.entregaError = errorTexto;
  guardarCampanaPronto();
  return true;
};

// ── LOG EXPORT ────────────────────────────────────────────
// Datos extra del cliente para la ficha en Conversaciones (solo los que vengan en el Excel)
function datosFicha(c) {
  const o = {};
  ['cedula', 'vendedor', 'calMensual', 'calRodamiento', 'rodamiento'].forEach(k => { if (c[k]) o[k] = String(c[k]); });
  if (c.tienda) o.tienda = String(c.tienda);
  if (c.saldoTotal) o.saldoTotal = Number(c.saldoTotal);
  if (c.nombre) o.nombreCompleto = String(c.nombre);
  return o;
}

// ── GUARDAR CÉDULAS SIN ENVIAR ─────────────────────────────
// Agrega la cédula a los clientes que ya recibieron mensajes
// (no crea clientes nuevos ni cambia deuda, días ni mes).
exports.guardarCedulas = async (req, res) => {
  try {
    const lista = (req.body && Array.isArray(req.body.clients) ? req.body.clients : [])
      .map(c => ({ numero: String(c.numero || '').replace(/[^0-9]/g, ''), datos: datosFicha({ ...c, cedula: normalizarCedula(c.cedula) }) }))
      .filter(c => c.numero && Object.keys(c.datos).some(k => k !== 'nombreCompleto'));
    if (!lista.length) return res.status(400).json({ ok: false, error: 'La base no trae cédula ni datos del cliente.' });
    let actualizados = 0;
    for (let i = 0; i < lista.length; i += 300) {
      const parte = lista.slice(i, i + 300);
      const snaps = await db.getAll(...parte.map(c => db.collection('cobranza_clientes').doc(c.numero)));
      const batch = db.batch();
      snaps.forEach((snap, j) => {
        if (snap.exists) { batch.set(snap.ref, parte[j].datos, { merge: true }); actualizados++; }
      });
      await batch.commit();
    }
    res.json({ ok: true, actualizados, total: lista.length });
  } catch (err) {
    console.error('Error guardando cédulas:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};

exports.getLog = (req, res) => {
  res.json({ ok: true, log: activeJob.log, stats: {
    total:  activeJob.total,
    sent:   activeJob.sent,
    failed: activeJob.failed,
    campaignName: activeJob.campaignName,
    startedAt:    activeJob.startedAt,
    finishedAt:   activeJob.finishedAt,
  }});
};

// ── HELPERS ───────────────────────────────────────────────

/**
 * Construir mensaje personalizado reemplazando variables
 * Soporta: {nombre} {deuda} {dias} {dias_mora} {vencimiento} {cobrador} {tienda}
 */
function buildMessage(template, client) {
  if (!template) {
    const deudaFmt = client.deuda.toLocaleString('es-EC', { minimumFractionDigits: 2 });
    return `Estimado/a ${client.nombre}, le informamos que mantiene un saldo pendiente de $${deudaFmt} con ${client.dias} días de atraso. Se solicita regularizar en un plazo máximo de 48 horas para evitar acciones legales. Marcimex.`;
  }
  const deudaFmt = client.deuda.toLocaleString('es-EC', { minimumFractionDigits: 2 });
  return template
    .replace(/\{nombre\}/gi,      client.nombre)
    .replace(/\{deuda\}/gi,       '$' + deudaFmt)
    .replace(/\{monto\}/gi,       '$' + deudaFmt)
    .replace(/\{dias\}/gi,        client.dias)
    .replace(/\{dias_mora\}/gi,   client.dias)
    .replace(/\{vencimiento\}/gi, client.dias + ' días')
    .replace(/\{cobrador\}/gi,    client.cobrador || '')
    .replace(/\{tienda\}/gi,      client.tienda   || '');
}

const MESES_TXT = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// ── Teléfonos de Ecuador ──────────────────────────────────
// 0989938910 → 593989938910 · 989938910 → 593989938910 · +593 98… → 593…
// Cédula/RUC: solo dígitos; si Excel quitó el 0 inicial (9 dígitos) se repone
function normalizarCedula(valor) {
  let t = String(valor == null ? '' : valor).trim().replace(/\.0+$/, '').replace(/[^0-9]/g, '');
  if (t.length === 9 || t.length === 12) t = '0' + t;
  return t;
}

function normalizarTelefono(valor) {
  let t = String(valor == null ? '' : valor).replace(/[^0-9]/g, '');
  if (t.startsWith('00')) t = t.slice(2);                       // 00593… (formato internacional)
  if (t.length === 10 && t.startsWith('09')) t = '593' + t.slice(1);
  else if (t.length === 9 && t.startsWith('9')) t = '593' + t;  // Excel quitó el 0 inicial
  return t;
}

// ── Montos: 120.5 · "120,50" · "$120.50" · "1.234,56" · "1,234.56" ──
function parseMonto(valor) {
  if (typeof valor === 'number') return isFinite(valor) ? valor : 0;
  let s = String(valor == null ? '' : valor).replace(/[^0-9.,-]/g, '');
  if (!s) return 0;
  const ultComa = s.lastIndexOf(','), ultPunto = s.lastIndexOf('.');
  if (ultComa > -1 && ultPunto > -1) {
    // El separador que aparece al final es el decimal
    if (ultComa > ultPunto) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (ultComa > -1 || ultPunto > -1) {
    const sep = ultComa > -1 ? ',' : '.';
    const partes = s.split(sep);
    // Un solo separador seguido de exactamente 3 dígitos = miles (1.234 / 1,234)
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3)) s = partes.join('');
    else s = partes.join('.');
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// ── Variables configurables de plantilla ──────────────────
const CAMPOS_VARIABLES = ['nombre', 'deuda', 'dias', 'cobrador', 'tienda', 'categoria', 'numero', 'mes'];

function esTextoFijo(v) {
  const s = String(v || '').trim();
  return s.length >= 2 && /^["'“”].*["'“”]$/.test(s);
}

function esCampoValido(v) {
  return esTextoFijo(v) || CAMPOS_VARIABLES.includes(normalize(v));
}

// Devuelve el valor de un campo del cliente, o el texto fijo entre comillas.
// Meta rechaza variables vacías, por eso se usa "-" si el dato no existe.
function valorCampo(v, c) {
  if (esTextoFijo(v)) return String(v).trim().slice(1, -1) || '-';
  const campo = normalize(v);
  let val;
  if (campo === 'deuda') val = (c.deuda || 0).toLocaleString('es-EC', { minimumFractionDigits: 2 });
  else if (campo === 'dias') val = String(c.dias ?? '');
  else val = c[campo];
  val = String(val == null ? '' : val).trim();
  return val || '-';
}

function normalize(str) {
  return String(str).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_\-]/g, '');
}
