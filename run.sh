#!/usr/bin/env bash
# Levanta el backend revisando antes Node, dependencias, variables de entorno, MongoDB, Cloudinary y SMTP.
#
#   ./run.sh          desarrollo, con recarga automática (npm run dev)
#   ./run.sh prod     compila y corre lo compilado, como en Render (npm run build + npm start)
#   ./run.sh check    solo revisa, no levanta nada
#
# Nunca imprime los valores del .env: solo dice si están, si tienen buena forma y si funcionan.
set -euo pipefail
cd "$(dirname "$0")"

MODO="${1:-dev}"
case "$MODO" in
  dev | prod | check) ;;
  *)
    echo "Uso: ./run.sh [dev|prod|check]" >&2
    exit 1
    ;;
esac

if [ -t 1 ]; then
  VERDE=$'\e[32m' AMARILLO=$'\e[33m' ROJO=$'\e[31m' NEGRITA=$'\e[1m' NORMAL=$'\e[0m'
else
  VERDE='' AMARILLO='' ROJO='' NEGRITA='' NORMAL=''
fi

titulo() { printf '\n%s%s%s\n' "$NEGRITA" "$1" "$NORMAL"; }
ok() { printf '  %s✔%s %s\n' "$VERDE" "$NORMAL" "$1"; }
aviso() { printf '  %s!%s %s\n' "$AMARILLO" "$NORMAL" "$1"; }
error() { printf '  %s✖%s %s\n' "$ROJO" "$NORMAL" "$1"; }
abortar() {
  local resultado='No se levantó el back.'
  [ "$MODO" = check ] && resultado='Hay problemas.'
  printf '\n%s%s%s Corregí lo marcado con ✖ y volvé a correr ./run.sh\n' "$ROJO" "$resultado" "$NORMAL"
  exit 1
}

# ─── 1. Node y dependencias ───────────────────────────────────────────────────
titulo 'Node y dependencias'

if ! command -v node >/dev/null; then
  error 'No está instalado Node.js (hace falta la versión 18 o más nueva)'
  abortar
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  error "Node $(node -v) es viejo: hace falta la versión 18 o más nueva"
  abortar
fi
ok "Node $(node -v)"

# npm ls falla si falta algún paquete o no coincide con package-lock.json (por ejemplo, después de un pull)
if [ ! -d node_modules ] || ! npm ls --depth=0 >/dev/null 2>&1; then
  aviso 'Faltan dependencias o cambiaron: instalando…'
  npm install --no-audit --no-fund
fi
ok 'Dependencias instaladas'

if [ -f .env ]; then
  ok 'Hay archivo .env'
else
  aviso 'No hay .env: se usan solo las variables del sistema (crealo con: cp .env.example .env)'
fi

# ─── 2. Variables, MongoDB, Cloudinary y puerto ───────────────────────────────
# Se revisa con Node y dotenv para ver las variables exactamente como las ve la app
if ! MODO="$MODO" node - <<'JS'
require('dotenv').config({ quiet: true });
const net = require('node:net');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

const conColor = process.stdout.isTTY;
const pintar = (codigo, texto) => (conColor ? `\x1b[${codigo}m${texto}\x1b[0m` : texto);
let errores = 0;
const titulo = (t) => console.log(`\n${pintar(1, t)}`);
const ok = (m) => console.log(`  ${pintar(32, '✔')} ${m}`);
const aviso = (m) => console.log(`  ${pintar(33, '!')} ${m}`);
const error = (m) => {
  errores++;
  console.log(`  ${pintar(31, '✖')} ${m}`);
};

const env = (nombre) => (process.env[nombre] ?? '').trim();
// Por si algún mensaje de error trae la URI con usuario y contraseña
const ocultar = (texto) => String(texto).replace(/\/\/[^@\s/]+@/g, '//***@');

function explicarMongo(e) {
  const m = String(e?.message ?? e);
  if (/bad auth|authentication failed/i.test(m)) return 'usuario o contraseña incorrectos en MONGODB_URI';
  if (/querySrv|ENOTFOUND|EAI_AGAIN/i.test(m)) return 'no se encontró el servidor: revisá el host de MONGODB_URI y tu conexión a internet';
  if (/whitelist|ip access list|IP that isn't/i.test(m)) return 'Atlas no acepta tu IP: agregala (o 0.0.0.0/0) en Network Access';
  // Mongoose envuelve los errores del driver: MongooseServerSelectionError, MongoParseError…
  if (/ServerSelectionError$/.test(e?.name)) return 'el servidor no respondió: revisá Network Access en Atlas y tu conexión a internet';
  if (/ParseError$/.test(e?.name)) return 'MONGODB_URI tiene un formato inválido (si la contraseña tiene símbolos, codificalos: @ → %40)';
  return ocultar(m);
}

// El error de Cloudinary trae la key y el secret en request_options: nunca se imprime entero
// Solo el código del error: el mensaje del servidor SMTP puede repetir el usuario
function explicarSmtp(e) {
  if (e?.code === 'EAUTH') return 'rechazó SMTP_USER o SMTP_PASS (con Gmail, SMTP_PASS es una contraseña de aplicación)';
  if (['ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'EDNS'].includes(e?.code)) return 'no se pudo conectar: revisá SMTP_HOST y SMTP_PORT';
  return `respondió con error${e?.code ? ` (${e.code})` : ''}`;
}

function explicarCloudinary(e) {
  const err = e?.error ?? e;
  if (/cloud_name/i.test(String(err?.message))) return 'CLOUDINARY_CLOUD_NAME no existe';
  // Con un 401 Cloudinary no distingue cuál de los tres está mal (un cloud_name inventado da "api_secret mismatch")
  if (err?.http_code === 401) return 'rechazó las credenciales: revisá CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET';
  if (err?.http_code) return `respondió con error ${err.http_code}`;
  return 'no se pudo contactar (¿hay internet?)';
}

async function main() {
  titulo('Variables de entorno');
  const obligatorias = [
    ['MONGODB_URI', 'conexión a la base'],
    ['JWT_SECRET', 'tokens del login'],
  ];
  for (const [nombre, para] of obligatorias) {
    if (env(nombre)) ok(nombre);
    else error(`Falta ${nombre} (${para})`);
  }

  // Sin Cloudinary la API anda igual, solo no se pueden subir fotos; a medio cargar es un error
  const variablesCloudinary = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const faltanCloudinary = variablesCloudinary.filter((nombre) => !env(nombre));
  const hayCloudinary = faltanCloudinary.length === 0;
  if (hayCloudinary) ok('CLOUDINARY_* (las 3)');
  else if (faltanCloudinary.length === variablesCloudinary.length)
    aviso('Cloudinary sin configurar: la API anda, pero no se van a poder subir fotos de productos ni promos');
  else error(`Cloudinary a medio configurar, falta: ${faltanCloudinary.join(', ')}`);

  // Sin SMTP la API anda igual, solo no se puede recuperar la contraseña por email
  const variablesSmtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const faltanSmtp = variablesSmtp.filter((nombre) => !env(nombre));
  const haySmtp = faltanSmtp.length === 0;
  if (haySmtp) ok('SMTP_* (recuperar la contraseña por email)');
  else if (faltanSmtp.length === variablesSmtp.length)
    aviso('SMTP sin configurar: la API anda, pero el dueño no va a poder recuperar la contraseña por email');
  else error(`SMTP a medio configurar, falta: ${faltanSmtp.join(', ')}`);

  const uri = env('MONGODB_URI');
  if (uri && !/^mongodb(\+srv)?:\/\//.test(uri)) error('MONGODB_URI tiene que empezar con mongodb:// o mongodb+srv://');

  const jwt = env('JWT_SECRET');
  if (jwt && jwt.length < 32) aviso('JWT_SECRET es corta: usá al menos 32 caracteres aleatorios (openssl rand -hex 32)');

  const puerto = env('PORT') ? Number(env('PORT')) : 3000;
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) error('PORT no es un número de puerto válido');

  const origenes = env('CORS_ORIGINS').split(',').map((o) => o.trim()).filter(Boolean);
  if (!origenes.length) {
    aviso('CORS_ORIGINS está vacía: la web no va a poder usar la API (la APK sí)');
  } else {
    ok(`CORS_ORIGINS (${origenes.length} ${origenes.length === 1 ? 'dominio' : 'dominios'})`);
    // index.ts compara el origin exacto: "*" o una "/" final nunca coinciden con lo que manda el navegador
    if (origenes.includes('*')) aviso('CORS_ORIGINS no acepta "*": poné los dominios de la web');
    if (origenes.some((o) => o.endsWith('/'))) aviso('Sacá la "/" final de los dominios de CORS_ORIGINS: si no, no coinciden');
  }

  // Sin las variables no tiene sentido probar las conexiones
  if (errores) return;

  titulo('Base de datos y servicios');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    const db = mongoose.connection.db;
    await db.command({ ping: 1 });
    ok(`MongoDB conectado (base "${mongoose.connection.name}")`);
    const admins = await db.collection('admins').countDocuments();
    if (admins) ok('Hay usuario admin para el login');
    else aviso('No hay usuario admin: corré "npm run crear-admin" para poder entrar desde la app');
    if (admins && haySmtp) {
      const conEmail = await db.collection('admins').countDocuments({ email: { $exists: true, $ne: '' } });
      if (conEmail) ok('El admin tiene email para recuperar la contraseña');
      else aviso('El admin no tiene email: cargá ADMIN_EMAIL en el .env y corré "npm run crear-admin"');
    }
  } catch (e) {
    error(`MongoDB: ${explicarMongo(e)}`);
  } finally {
    await mongoose.disconnect().catch(() => {});
  }

  if (hayCloudinary) {
    cloudinary.config({
      cloud_name: env('CLOUDINARY_CLOUD_NAME'),
      api_key: env('CLOUDINARY_API_KEY'),
      api_secret: env('CLOUDINARY_API_SECRET'),
    });
    try {
      await cloudinary.api.ping({ timeout: 10000 });
      ok('Cloudinary acepta las credenciales');
    } catch (e) {
      error(`Cloudinary: ${explicarCloudinary(e)}`);
    }
  }

  if (haySmtp) {
    const nodemailer = require('nodemailer');
    const puertoSmtp = Number(env('SMTP_PORT')) || 465;
    const transporte = nodemailer.createTransport({
      host: env('SMTP_HOST'),
      port: puertoSmtp,
      secure: puertoSmtp === 465,
      auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
      connectionTimeout: 10000,
    });
    try {
      await transporte.verify();
      ok('El SMTP acepta las credenciales');
    } catch (e) {
      error(`SMTP: ${explicarSmtp(e)}`);
    } finally {
      transporte.close();
    }
  }

  const libre = await new Promise((resolver) => {
    const servidor = net.createServer();
    servidor.once('error', () => resolver(false));
    servidor.once('listening', () => servidor.close(() => resolver(true)));
    servidor.listen(puerto);
  });
  if (libre) ok(`Puerto ${puerto} libre`);
  else {
    const mensaje = `El puerto ${puerto} está ocupado: ¿ya está corriendo el back? (lsof -i :${puerto})`;
    // En "check" es solo informativo: puede ser justamente el back que ya está levantado
    if (process.env.MODO === 'check') aviso(mensaje);
    else error(mensaje);
  }
}

main()
  .catch((e) => error(ocultar(e?.message ?? e)))
  .finally(() => process.exit(errores ? 1 : 0));
JS
then
  abortar
fi

# ─── 3. Levantar ──────────────────────────────────────────────────────────────
# Las direcciones donde va a quedar la API. Si algo falla acá, el back se levanta igual
mostrarDirecciones() {
  titulo 'La API va a quedar en'
  node - <<'JS' || aviso 'No se pudieron calcular las direcciones'
require('dotenv').config({ quiet: true });
const dgram = require('node:dgram');

// El mismo cálculo que index.ts
const puerto = Number(process.env.PORT) || 3000;

// La IP de la interfaz que sale a internet: "conectar" un socket UDP no manda ningún paquete
function ipEnLaRed() {
  return new Promise((resolver) => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => resolver(null));
    socket.connect(53, '8.8.8.8', (error) => {
      resolver(error ? null : socket.address().address);
      socket.close();
    });
  });
}

ipEnLaRed().then((ip) => {
  console.log(`  Local:      http://localhost:${puerto}   (EXPO_PUBLIC_API_URL del front)`);
  if (ip) console.log(`  En tu red:  http://${ip}:${puerto}   (desde otro dispositivo en el mismo Wi-Fi)`);
  console.log(`  Health:     http://localhost:${puerto}/health`);
});
JS
}

case "$MODO" in
  check)
    printf '\n%sTodo en orden.%s Para levantarlo: ./run.sh (o ./run.sh prod)\n' "$VERDE" "$NORMAL"
    ;;
  dev)
    mostrarDirecciones
    titulo 'Levantando en modo desarrollo (Ctrl+C para cortar)'
    exec npm run dev
    ;;
  prod)
    titulo 'Compilando'
    npm run build
    mostrarDirecciones
    titulo 'Levantando en modo producción (Ctrl+C para cortar)'
    exec npm start
    ;;
esac
