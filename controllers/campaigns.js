/**
 * Campaign Controller
 * Lógica de negocio para campañas masivas
 */

const XLSX = require('xlsx');
const wa   = require('../services/whatsapp');

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
    const colDias     = find('DIAS VENCIDOS','Días vencidos','dias vencidos','dias','vencidos','DIAS','DíasVencidos');
    const colMensaje  = find('MENSAJE','Mensaje','mensaje','MESSAGE');
    const colCobrador = find('Nombre del Cobrador Actual','Cobrador','cobrador','COBRADOR');
    const colTienda   = find('Tienda Factura','Tienda','tienda','TIENDA');
    const colCategoria= find('Categoría Cliente','Categoria','categoria','CATEGORIA');

    if (!colNombre || !colNumero) {
      return res.status(400).json({
        ok: false,
        error: `No se encontraron columnas de Nombre y Número. Columnas disponibles: ${keys.join(', ')}`
      });
    }

    // Parsear clientes
    const clients = raw.map((row, i) => {
      const nombre   = String(row[colNombre] || '').trim();
      const numero   = String(row[colNumero] || '').replace(/\s+/g,'').replace(/[^0-9+]/g,'');
      const deuda    = parseFloat(String(row[colDeuda]  || '0').replace(/[^0-9.]/g,'')) || 0;
      const dias     = parseInt(String(row[colDias]     || '0').replace(/[^0-9]/g,''))  || 0;
      const mensajePre = colMensaje  ? String(row[colMensaje]  || '').trim() : '';
      const cobrador   = colCobrador ? String(row[colCobrador] || '').trim() : '';
      const tienda     = colTienda   ? String(row[colTienda]   || '').trim() : '';
      const categoria  = colCategoria? String(row[colCategoria]|| '').trim() : '';

      return { id: i + 1, nombre, numero, deuda, dias, mensajePre, cobrador, tienda, categoria };
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

    const {
      clients,
      template,         // texto con variables {nombre} {deuda} etc.
      useTemplate,      // true = plantilla Meta | false = texto libre
      templateName,     // nombre de plantilla aprobada en Meta
      templateLang,     // código de idioma, ej: 'es'
      delay = 10000,    // ms entre mensajes
      campaignName = 'Campaña ' + new Date().toLocaleDateString('es-EC'),
    } = req.body;

    if (!clients || !clients.length) {
      return res.status(400).json({ ok: false, error: 'Sin clientes para enviar.' });
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

    // Responder inmediatamente
    res.json({ ok: true, jobId: activeJob.id, message: `Iniciando campaña "${campaignName}" con ${clients.length} clientes.` });

    // Envío asíncrono
    (async () => {
      for (let i = 0; i < clients.length; i++) {
        // Control de pausa
        while (activeJob.paused && activeJob.running) {
          await wa.sleep(1000);
        }
        if (!activeJob.running) break;

        const c = clients[i];
        activeJob.current = c.nombre;

        try {
          let result;

          if (useTemplate && templateName) {
            // Plantilla aprobada Meta — variables dinámicas
            const deudaFmt = c.deuda.toLocaleString('es-EC', { minimumFractionDigits: 2 });
            const variables = [c.nombre, deudaFmt, String(c.dias)];
            const components = wa.buildTemplateComponents(variables);
            result = await wa.sendTemplateMessage(c.numero, templateName, templateLang || 'es', components);
          } else {
            // Texto libre personalizado
            const mensaje = buildMessage(template, c);
            result = await wa.sendTextMessage(c.numero, mensaje);
          }

          activeJob.sent++;
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

        // Delay entre mensajes (saltar en el último)
        if (i < clients.length - 1 && activeJob.running) {
          await wa.sleep(delay);
        }
      }

      activeJob.running    = false;
      activeJob.finishedAt = new Date().toISOString();
      activeJob.current    = '';
      console.log(`\n🎉 Campaña finalizada. Enviados: ${activeJob.sent} | Fallidos: ${activeJob.failed}`);
    })();

  } catch (err) {
    activeJob.running = false;
    console.error('startCampaign error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ── CONTROLES ─────────────────────────────────────────────
exports.pauseCampaign = (req, res) => {
  activeJob.paused = true;
  res.json({ ok: true, message: 'Campaña pausada.' });
};

exports.resumeCampaign = (req, res) => {
  activeJob.paused = false;
  res.json({ ok: true, message: 'Campaña reanudada.' });
};

exports.stopCampaign = (req, res) => {
  activeJob.running = false;
  activeJob.paused  = false;
  res.json({ ok: true, message: 'Campaña detenida.' });
};

// ── STATUS ────────────────────────────────────────────────
exports.getStatus = (req, res) => {
  const pct = activeJob.total
    ? Math.round(((activeJob.sent + activeJob.failed) / activeJob.total) * 100)
    : 0;
  res.json({ ...activeJob, pct });
};

// ── LOG EXPORT ────────────────────────────────────────────
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

function normalize(str) {
  return String(str).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_\-]/g, '');
}
