/**
 * Bot de COBRANZAS (sin IA, sin costo).
 * Responde con un menú y palabras clave usando SOLO datos reales:
 *  - Saldo: el último dato que se le envió al cliente en una campaña
 *    (colección "cobranza_clientes", se llena al enviar campañas).
 *  - Textos de agencias/horario: archivo cobranza.txt (editable en GitHub).
 * Registra comprobantes, promesas de pago y números equivocados.
 */

const fs = require("fs");
const path = require("path");

// ── Configuración desde cobranza.txt ─────────────────────
function leerConfig() {
  const cfg = {};
  try {
    const txt = fs.readFileSync(path.join(__dirname, "..", "cobranza.txt"), "utf8");
    let actual = null;
    for (const linea of txt.split("\n")) {
      const t = linea.trim();
      if (t.startsWith("## ")) { actual = t.slice(3).trim().toUpperCase(); cfg[actual] = []; continue; }
      if (t.startsWith("#")) continue;
      if (actual) cfg[actual].push(linea.replace(/\s+$/, ""));
    }
    for (const k of Object.keys(cfg)) cfg[k] = cfg[k].join("\n").trim();
  } catch (e) {
    console.error("No se pudo leer cobranza.txt:", e.message);
  }
  return {
    empresa: cfg.EMPRESA || "Marcimex",
    horario: cfg.HORARIO || "lunes a viernes de 08:00 a 18:00",
    lugaresPago: cfg.LUGARES_PAGO || "Puede realizar su pago en cualquier agencia o con su gestor de cobranzas.",
    despedidaEquivocado: cfg.DESPEDIDA_EQUIVOCADO || "Disculpe la molestia, no volveremos a escribirle.",
    despedidaSalir: cfg.DESPEDIDA_SALIR || "Entendido, no volverá a recibir recordatorios por este medio.",
    gestores: leerGestores(cfg.GESTORES || "")
  };
}

// "NOMBRE DEL GESTOR = 0987654321" → { "nombre normalizado": "593987654321" }
function leerGestores(texto) {
  const mapa = {};
  for (const linea of String(texto).split("\n")) {
    const i = linea.indexOf("=");
    if (i < 0) continue;
    const nombre = normNombre(linea.slice(0, i));
    const tel = normTel(linea.slice(i + 1));
    if (nombre && tel) mapa[nombre] = tel;
  }
  return mapa;
}
function normNombre(t) {
  return String(t || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-ZÑ ]/g, " ").replace(/\s+/g, " ").trim();
}
function normTel(v) {
  let t = String(v || "").replace(/\D/g, "");
  if (t.startsWith("00")) t = t.slice(2);
  if (t.length === 10 && t.startsWith("09")) t = "593" + t.slice(1);
  else if (t.length === 9 && t.startsWith("9")) t = "593" + t;
  return /^5939\d{8}$/.test(t) ? t : "";
}
const CFG = leerConfig();

const DIA_MS = 24 * 60 * 60 * 1000;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_SEMANA = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

function norm(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ/\-\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tiene(t, palabras) {
  const s = " " + t;
  return palabras.some(p => s.includes(" " + p));
}
function money(n) {
  return "$" + Number(n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function titulo(nombre) {
  return String(nombre || "").toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/(^|\s)\S/g, s => s.toUpperCase());
}
function msDe(v) {
  if (!v) return 0;
  if (v.toDate) return v.toDate().getTime();
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}
// Fecha en Ecuador (UTC-5) como "dd/mm/aaaa"
function fechaEC(ms) {
  const d = new Date(ms - 5 * 3600 * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
function hoyEC() {
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Interpreta la fecha que escribe el cliente: 25/10, 25-10-2026, hoy, mañana, pasado mañana, viernes, 25 de octubre
function interpretarFecha(texto) {
  const t = norm(texto);
  const hoy = hoyEC();
  if (/\bpasado manana\b/.test(t)) return hoy + 2 * DIA_MS;
  if (/\bmanana\b/.test(t)) return hoy + DIA_MS;
  if (/\bhoy\b/.test(t)) return hoy;

  let m = t.match(/\b(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?:\s*[\/\-]\s*(\d{2,4}))?\b/);
  if (m) {
    const dia = +m[1], mes = +m[2];
    let anio = m[3] ? +m[3] : new Date(hoy).getUTCFullYear();
    if (anio < 100) anio += 2000;
    let f = Date.UTC(anio, mes - 1, dia);
    if (!m[3] && f < hoy) f = Date.UTC(anio + 1, mes - 1, dia);
    const d = new Date(f);
    if (d.getUTCDate() !== dia || d.getUTCMonth() !== mes - 1) return null;
    return f;
  }
  m = t.match(/\b(\d{1,2})\s+de\s+([a-z]+)/);
  if (m) {
    const mes = MESES.indexOf(m[2]);
    if (mes >= 0) {
      const anio = new Date(hoy).getUTCFullYear();
      let f = Date.UTC(anio, mes, +m[1]);
      if (f < hoy) f = Date.UTC(anio + 1, mes, +m[1]);
      return f;
    }
  }
  for (const [nombre, num] of Object.entries(DIAS_SEMANA)) {
    if (new RegExp("\\b" + nombre + "\\b").test(t)) {
      const actual = new Date(hoy).getUTCDay();
      let dif = (num - actual + 7) % 7;
      if (dif === 0) dif = 7;
      return hoy + dif * DIA_MS;
    }
  }
  return null;
}

const DIAS_MAX_PROMESA = 5;

// Fecha máxima para la promesa: 5 días después del mensaje de la campaña.
// Si ese plazo ya pasó, solo se acepta pagar hoy. Sin campaña: 5 días desde hoy.
function limitePromesa(cliente) {
  const hoy = hoyEC();
  const envioMs = cliente ? msDe(cliente.fecha) : 0;
  if (!envioMs) return hoy + DIAS_MAX_PROMESA * DIA_MS;
  const d = new Date(envioMs - 5 * 3600 * 1000);
  const diaEnvio = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(hoy, diaEnvio + DIAS_MAX_PROMESA * DIA_MS);
}
function ddmm(ms) { return fechaEC(ms + 5 * 3600 * 1000).slice(0, 5); }

function telefonoGestor(cliente) {
  if (!cliente) return "";
  const directo = normTel(cliente.telefonoCobrador);
  if (directo) return directo;
  const nombre = normNombre(cliente.cobrador);
  if (!nombre) return "";
  if (CFG.gestores[nombre]) return CFG.gestores[nombre];
  const palabras = nombre.split(" ").filter(p => p.length > 2);
  for (const [n, tel] of Object.entries(CFG.gestores)) {
    const coinciden = palabras.filter(p => n.split(" ").includes(p)).length;
    if (coinciden >= Math.min(3, palabras.length)) return tel;
  }
  return "";
}

function textoGestor(cliente, gestor) {
  const tel = telefonoGestor(cliente);
  if (tel) {
    return `Listo ✅ ${gestor} le atenderá.\n📞 Escríbale directamente aquí: https://wa.me/${tel}\nHorario: ${CFG.horario}.`;
  }
  return `Listo ✅ ${gestor} le contactará lo antes posible (horario: ${CFG.horario}).`;
}

function menu(saludo) {
  return `${saludo}
Escriba el número de la opción:
1️⃣ Consultar mi saldo
2️⃣ Lugares y formas de pago
3️⃣ Ya pagué / enviar comprobante
4️⃣ Acordar una fecha de pago
5️⃣ Hablar con mi gestor
6️⃣ No soy el cliente / número equivocado`;
}

/**
 * Decide la respuesta.
 * @param {object} p
 *  - texto: mensaje del cliente
 *  - esArchivo: si envió foto/documento
 *  - cliente: datos de cobranza_clientes (o null)
 *  - conv: documento de la conversación (para saber el paso actual)
 * @returns {object} { texto, atender, paso, etiqueta, promesa, excluir, pausar }
 */
function responder({ texto, esArchivo, tipoMensaje, cliente, conv }) {
  const t = norm(texto);
  const paso = conv && conv.cobranzaPaso;
  const nombre = cliente ? titulo(cliente.nombre) : "";
  const saludo = `Hola${nombre ? " " + nombre : ""} 👋 Le saluda el asistente de cobranzas de ${CFG.empresa}.`;
  const gestor = cliente && cliente.cobrador ? titulo(cliente.cobrador) : "su gestor de cobranzas";

  // ── Archivos (comprobantes) ──
  // Audio, video, ubicación, contacto: el bot no los entiende
  if (esArchivo && !["image", "document"].includes(tipoMensaje || "image")) {
    return {
      texto: "Por este medio solo puedo leer mensajes escritos 📝 Escriba su consulta o MENÚ para ver las opciones.",
      paso: (conv && conv.cobranzaPaso) || null
    };
  }

  // Foto o documento = comprobante
  if (esArchivo) {
    return {
      texto: `Recibimos su archivo ✅ ${gestor} lo validará y le confirmará. Gracias por su pago.`,
      atender: true, paso: null, etiqueta: "comprobante"
    };
  }

  // ── Pedir salir / número equivocado (tienen prioridad) ──
  if (tiene(t, ["salir", "stop", "no me escriban", "no me escribas", "no quiero mensajes", "dejen de escribir", "baja"])) {
    return { texto: CFG.despedidaSalir, excluir: "salir", etiqueta: "no contactar", paso: null };
  }
  if (t === "6" || tiene(t, ["no soy", "numero equivocado", "equivocado", "equivocada", "no conozco", "no es mi", "se equivoco"])) {
    return { texto: CFG.despedidaEquivocado, excluir: "equivocado", etiqueta: "equivocado", paso: null };
  }

  // ── Solicitud de refinanciación ──
  // Solo para clientes cuya última campaña fue una plantilla de refinanciación
  // (nombre con "refinanc", ej. refinanciamiento_marcimex). Al resto el bot
  // les responde como siempre (menú normal).
  const recibioRefinanciacion = !!(cliente && /refinanc/i.test(String(cliente.plantilla || "")));
  if (recibioRefinanciacion && tiene(t, ["refinanc", "quiero refinanc"])) {
    return {
      texto: `Recibimos su solicitud de revisión para refinanciación ✅ ${gestor} se comunicará con usted (horario: ${CFG.horario}).\nLa refinanciación está sujeta a evaluación y aprobación de ${CFG.empresa}.`,
      atender: true, pausar: true, paso: null, etiqueta: "refinanciar"
    };
  }

  // ── Esperando la fecha de la promesa de pago ──
  if (paso === "fecha" && !/^[1-6]$/.test(t)) {
    const f = interpretarFecha(texto);
    const hoy = hoyEC();
    if (!f) {
      return { texto: "No entendí la fecha 🤔 Escríbala así, por ejemplo: 25/10 o \"mañana\" o \"viernes\".", paso: "fecha" };
    }
    const limite = limitePromesa(cliente);
    if (f < hoy) {
      return { texto: `Esa fecha ya pasó. Por favor escriba una fecha entre hoy y el ${ddmm(limite)}.`, paso: "fecha" };
    }
    if (f > limite) {
      return {
        texto: limite === hoy
          ? "El plazo para acordar una fecha ya venció; el pago debe realizarse hoy. Si necesita más tiempo, escriba 5 para hablar con su gestor."
          : `La fecha máxima para su pago es el ${ddmm(limite)} (${DIAS_MAX_PROMESA} días desde nuestro aviso). Por favor escriba una fecha hasta ese día, o escriba 5 si necesita hablar con su gestor.`,
        paso: limite === hoy ? null : "fecha"
      };
    }
    const fTxt = fechaEC(f + 5 * 3600 * 1000);
    return {
      texto: `Perfecto ✅ Registramos su compromiso de pago para el ${fTxt}${cliente ? ` por ${money(cliente.deuda)}` : ""}. ${gestor} estará pendiente. ¡Gracias!`,
      paso: null, etiqueta: "promesa " + fTxt.slice(0, 5), promesa: { fechaMs: f, fechaTexto: fTxt }
    };
  }

  // ── Después del saldo: ¿desea hablar con un gestor? ──
  if (paso === "ofrecer_gestor" && !/^[1-6]$/.test(t)) {
    if (/^(si|sí|s|claro|ok|dale|bueno|por favor|si por favor|si quiero)\b/.test(t)) {
      return {
        texto: textoGestor(cliente, gestor),
        atender: true, pausar: true, paso: null, etiqueta: "pide gestor"
      };
    }
    if (/^(no|no gracias|nop|ahora no)\b/.test(t)) {
      return { texto: "Entendido 👍 Si desea acordar una fecha de pago escriba 4, o MENÚ para ver todas las opciones.", paso: null };
    }
  }

  // ── Esperando comprobante y escribió texto ──
  if (paso === "comprobante" && !/^[1-6]$/.test(t) && !tiene(t, ["hola", "menu"])) {
    return {
      texto: `Gracias. Si tiene el comprobante, envíenos una foto por aquí 📷. ${gestor} revisará su caso.`,
      atender: true, paso: null, etiqueta: "dice que pagó"
    };
  }

  // ── Opciones ──
  const op =
    /^1\b/.test(t) || tiene(t, ["saldo", "cuanto debo", "cuanto es", "valor", "deuda", "debo"]) ? 1 :
    /^2\b/.test(t) || tiene(t, ["donde", "lugar", "agencia", "oficina", "almacen", "forma de pago", "formas de pago", "como pago", "como pagar", "cuenta bancaria", "horario"]) ? 2 :
    /^3\b/.test(t) || tiene(t, ["ya pague", "pague", "ya cancele", "cancele", "deposite", "transferi", "comprobante", "abone"]) ? 3 :
    /^4\b/.test(t) || tiene(t, ["fecha", "plazo", "pagare el", "voy a pagar", "puedo pagar", "no puedo pagar", "espera", "prorroga", "convenio"]) ? 4 :
    /^5\b/.test(t) || tiene(t, ["gestor", "asesor", "humano", "persona", "llamar", "llamen", "hablar"]) ? 5 :
    0;

  if (op === 1) {
    if (!cliente) {
      return {
        texto: "No encontramos información de crédito asociada a este número. Un gestor de cobranzas le contactará para ayudarle.",
        atender: true, paso: null, etiqueta: "sin datos"
      };
    }
    const corte = msDe(cliente.fecha);
    const diasHoy = (cliente.dias || 0) + (corte ? Math.max(0, Math.floor((Date.now() - corte) / DIA_MS)) : 0);
    const mes = cliente.mes ? ` (cuota de ${cliente.mes})` : "";
    return {
      texto: `${nombre ? nombre + ", s" : "S"}egún nuestro registro del ${corte ? fechaEC(corte) : "último corte"}, su saldo pendiente${mes} es de ${money(cliente.deuda)} más intereses y gastos de cobranza, con aproximadamente ${diasHoy} días de atraso.\n\nEste valor es referencial; si ya realizó un abono, confírmelo con ${gestor}.\n\n¿Desea hablar con un gestor de cobranzas? Responda SÍ o NO.\n(También puede escribir 4 para acordar una fecha de pago o 2 para ver dónde pagar.)`,
      paso: "ofrecer_gestor"
    };
  }
  if (op === 2) {
    return { texto: `${CFG.lugaresPago}\n\nHorario de atención: ${CFG.horario}.`, paso: null };
  }
  if (op === 3) {
    return { texto: "Gracias 🙌 Por favor envíenos una foto de su comprobante de pago por este medio.", paso: "comprobante" };
  }
  if (op === 4) {
    const limite = limitePromesa(cliente);
    if (limite === hoyEC()) {
      return {
        texto: "El plazo para acordar una fecha ya venció; su pago debe realizarse hoy. Escriba 2 para ver dónde pagar o 5 si necesita hablar con su gestor.",
        paso: null
      };
    }
    return { texto: `¿Qué día puede realizar su pago? 📅 Puede elegir una fecha hasta el ${ddmm(limite)}.\nEscríbala así: ${ddmm(hoyEC() + DIA_MS)}, "mañana" o el día de la semana.`, paso: "fecha" };
  }
  if (op === 5) {
    return {
      texto: textoGestor(cliente, gestor),
      atender: true, pausar: true, paso: null, etiqueta: "pide gestor"
    };
  }

  // Agradecimientos
  if (tiene(t, ["gracias", "ok", "listo", "perfecto", "bueno", "entendido", "vale"])) {
    return { texto: "¡Con gusto! 😊 Si necesita algo más, escriba MENÚ.", paso: null };
  }

  // Saludo o mensaje no reconocido → menú
  return { texto: menu(saludo), paso: null };
}

module.exports = { responder, interpretarFecha, CFG };
