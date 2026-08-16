import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
import pino from 'pino';
import baileysPkg, { DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { useSupabaseAuthState } from './sessionStore.js';
import { handleMessage } from './botLogic.js';

const makeWASocket = baileysPkg.default || baileysPkg;

const PORT = process.env.PORT || 3000;
const SESSION_ID = process.env.SESSION_ID || 'default-session';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let latestQR = null;
let isConnected = false;
let currentSock = null;

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    whatsapp_connected: isConnected,
    uptime_seconds: Math.floor(process.uptime()),
  });
});

app.get('/qr', async (_req, res) => {
  if (isConnected) {
    return res.send('<h2>✅ WhatsApp already connected. No QR needed.</h2>');
  }
  if (!latestQR) {
    return res.send(
      '<h2>⏳ Generating QR / Ready for Pairing Code...</h2>' +
        '<script>setTimeout(() => location.reload(), 4000);</script>' +
        '<p><a href="/link">Click here to Link via Phone Number instead</a></p>'
    );
  }

  const qrImage = await QRCode.toDataURL(latestQR);
  res.send(`
    <html>
      <body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;margin-top:40px;">
        <h2>Scan this QR with WhatsApp</h2>
        <img src="${qrImage}" width="280" height="280" alt="WhatsApp QR code" />
        <p>Open WhatsApp → Linked Devices → Link a Device</p>
        <p><a href="/link">Or Link via Phone Number without QR</a></p>
        <script>setTimeout(() => location.reload(), 8000);</script>
      </body>
    </html>
  `);
});

app.get('/link', (_req, res) => {
  if (isConnected) {
    return res.send('<h2>✅ WhatsApp already connected. No linking needed.</h2>');
  }
  res.send(`
    <html>
      <body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;margin-top:40px;">
        <h2>Link via Phone Number</h2>
        <p>Enter your WhatsApp number with Country Code (Digits only, no +):</p>
        <form method="POST" action="/link">
          <input type="text" name="phone" placeholder="91XXXXXXXXXX" required
                 style="padding:10px;font-size:16px;width:240px;border:1px solid #ccc;border-radius:4px;" />
          <br/><br/>
          <button type="submit" style="padding:10px 20px;font-size:16px;background:#25D366;color:#fff;border:none;border-radius:4px;cursor:pointer;">Get 8-Digit Code</button>
        </form>
        <p style="margin-top:20px;"><a href="/qr">Go back to QR Scan</a></p>
      </body>
    </html>
  `);
});

app.post('/link', async (req, res) => {
  if (isConnected) {
    return res.send('<h2>✅ WhatsApp already connected.</h2>');
  }
  if (!currentSock) {
    return res.send('<h2>⏳ Bot socket initializing... wait 5 seconds and try again.</h2>');
  }

  const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
  if (!phone || phone.length < 10) {
    return res.send('<h2>❌ Invalid number! Enter with country code (e.g. 919876543210).</h2><a href="/link">Back</a>');
  }

  try {
    // Request 8-digit Pairing Code from WhatsApp
    const code = await currentSock.requestPairingCode(phone);
    const formatted = code?.match(/.{1,4}/g)?.join('-') || code;

    res.send(`
      <html>
        <body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;margin-top:40px;">
          <h2>Your WhatsApp Pairing Code:</h2>
          <p style="font-size:40px;font-weight:bold;letter-spacing:4px;background:#f0f0f0;padding:15px 25px;border-radius:8px;color:#128C7E;">${formatted}</p>
          <div style="max-width:400px;text-align:left;line-height:1.6;">
            <b>Instructions:</b>
            <ol>
              <li>Open WhatsApp on your phone</li>
              <li>Tap <b>Linked Devices</b> → <b>Link a Device</b></li>
              <li>Tap <b>"Link with phone number instead"</b> at bottom</li>
              <li>Enter this 8-digit code</li>
            </ol>
          </div>
          <p style="color:red;">⚠️ Code expires in 60 seconds.</p>
          <a href="/link">Request new code</a>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Pairing code error:', err);
    res.send(`<h2>❌ Error generating code: ${err.message}</h2><p>Wait 10 seconds and try again.</p><a href="/link">Try again</a>`);
  }
});

async function startBot() {
  const { state, saveCreds } = await useSupabaseAuthState(SESSION_ID);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false, // Set false to allow seamless pairing code generation
    browser: Browsers.ubuntu('Chrome'), // REQUIRED for pairing code to be accepted by Meta
    markOnlineOnConnect: true,
  });

  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('⚠️ Connection closed. Reconnecting:', shouldReconnect);

      if (shouldReconnect) {
        setTimeout(() => startBot().catch((err) => console.error('Reconnect failed:', err)), 3000);
      } else {
        console.log('🔒 Logged out. Clear your Supabase session row and restart to re-link.');
      }
    } else if (connection === 'open') {
      isConnected = true;
      latestQR = null;
      console.log('✅ WhatsApp connected successfully via Baileys!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '';

        if (!text.trim()) continue;

        const phone = jid.split('@')[0];
        const reply = await handleMessage(phone, text);

        if (reply) {
          await sock.sendMessage(jid, { text: reply });
        }
      } catch (err) {
        console.error('Error handling message:', err);
      }
    }
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Link via Number: http://localhost:${PORT}/link`);
  console.log(`📱 Scan QR Code:    http://localhost:${PORT}/qr`);
});

startBot().catch((err) => console.error('❌ Failed to start bot:', err));
