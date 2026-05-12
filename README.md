<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ElhyAi Chat — Sistema Omnicanal</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg:#0d0f1a; --panel:#13162a; --surface:#1a1e35; --border:#252a45;
  --accent:#6c63ff; --accent2:#00d4aa; --text:#e8eaf6; --muted:#6b7299;
}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;}

.hero{text-align:center;margin-bottom:48px;}
.logo{font-family:'Syne',sans-serif;font-size:42px;font-weight:800;color:var(--accent);letter-spacing:-1px;}
.logo span{color:var(--accent2);}
.tagline{font-size:15px;color:var(--muted);margin-top:8px;}

.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;width:100%;max-width:860px;}
.card{background:var(--panel);border:1px solid var(--border);border-radius:20px;padding:28px;text-decoration:none;color:var(--text);transition:all 0.25s;display:flex;flex-direction:column;gap:12px;position:relative;overflow:hidden;}
.card::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,var(--card-a),var(--card-b));opacity:0;transition:opacity 0.3s;}
.card:hover{transform:translateY(-4px);border-color:var(--card-a);}
.card:hover::before{opacity:0.06;}
.card-icon{font-size:36px;}
.card-title{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;}
.card-desc{font-size:13px;color:var(--muted);line-height:1.6;}
.card-arrow{margin-top:auto;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;opacity:0.7;}
.card:hover .card-arrow{opacity:1;}

.footer{margin-top:48px;font-size:12px;color:var(--muted);text-align:center;}
.footer a{color:var(--accent2);text-decoration:none;}

@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.hero{animation:fadeUp 0.5s ease;}
.card:nth-child(1){animation:fadeUp 0.5s ease 0.1s both;}
.card:nth-child(2){animation:fadeUp 0.5s ease 0.2s both;}
.card:nth-child(3){animation:fadeUp 0.5s ease 0.3s both;}
</style>
</head>
<body>

<div class="hero">
  <div class="logo">ElhyAi <span>Chat</span></div>
  <div class="tagline">Plataforma Omnicanal con IA · WhatsApp Business API · ElhyAi Consultores</div>
</div>

<div class="cards">

  <a href="frontend/panel-agentes.html" class="card" style="--card-a:#6c63ff;--card-b:#00d4aa;">
    <div class="card-icon">💬</div>
    <div class="card-title">Panel de Agentes</div>
    <div class="card-desc">Gestiona todas las conversaciones de WhatsApp en tiempo real. Bot IA + atención humana integrados.</div>
    <div class="card-arrow">Abrir panel →</div>
  </a>

  <a href="frontend/campanas-masivas.html" class="card" style="--card-a:#00d4aa;--card-b:#ffd166;">
    <div class="card-icon">📢</div>
    <div class="card-title">Campañas Masivas</div>
    <div class="card-desc">Envía recordatorios de pago a miles de clientes desde Excel. 4 plantillas de cobranza incluidas.</div>
    <div class="card-arrow">Crear campaña →</div>
  </a>

  <a href="https://github.com/esancheza-eng/elhyai-chat" class="card" style="--card-a:#ff6b6b;--card-b:#6c63ff;" target="_blank">
    <div class="card-icon">⚙️</div>
    <div class="card-title">Backend / API</div>
    <div class="card-desc">Código del servidor Node.js. Despliega en Railway con tu PHONE_NUMBER_ID y tokens de Meta.</div>
    <div class="card-arrow">Ver en GitHub →</div>
  </a>

</div>

<div class="footer">
  ElhyAi Chat v1.0 · <a href="https://elhyai.com" target="_blank">elhyai.com</a> · Desarrollado por ElhyAi Consultores · Milagro, Ecuador
</div>

</body>
</html>
