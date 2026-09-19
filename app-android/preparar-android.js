// Ajusta o projeto Android gerado pelo Capacitor: permissoes de localizacao em segundo plano,
// servico em primeiro plano (Android 14) e notificacoes. Rodado pelo GitHub Actions antes do build.
const fs = require('fs');
const path = require('path');
const mf = path.join(__dirname, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let xml = fs.readFileSync(mf, 'utf8');
const perms = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
  'android.permission.INTERNET'
];
for (const p of perms) {
  if (!xml.includes(`"${p}"`)) xml = xml.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
}
xml = xml.replace('<application', '<application android:usesCleartextTraffic="false"');
fs.writeFileSync(mf, xml);
// nome e cor do app
const strings = path.join(__dirname, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (fs.existsSync(strings)) fs.writeFileSync(strings, fs.readFileSync(strings, 'utf8').replace(/<string name="app_name">[^<]*</, '<string name="app_name">Mix Campo<').replace(/<string name="title_activity_main">[^<]*</, '<string name="title_activity_main">Mix Campo<'));
console.log('AndroidManifest ajustado.');
