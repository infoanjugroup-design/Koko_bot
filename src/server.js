import 'dotenv/config';
import express from 'express';
import QRCode from 'qrcode';
import pino from 'pino';
import baileysPkg, { 
  DisconnectReason, 
  fetchLatestBaileysVersion, 
  Browsers, 
  delay 
} from '@whiskeysockets/baileys';
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
let isConnecting = false;

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
      '<h2>⏳ Initializing WhatsApp Socket...</h2>' +
        '<p>Please refresh in 5 seconds or try linking via phone number.</p>' +
        '<script>setTimeout(() => location.reload(), 5000);</script>' +
        '<p><a href="/link">👉 Link via Phone Number instead</a></p>'
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
        <script>setTimeout(() => location.reload(), 10000);</script>
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
        <h2>WhatsApp Phone Number Pairing</h2>
        <p>Enter your bot number with country code (Digits only, e.g. <b>91XXXXXXXXXX</b>):</p>
        <form method="POST" action="/link">
          <input type="text" name="phone" placeholder="919876543210" required
                 style="padding:10px;font-size:16px;width:240px;border:1px solid #ccc;border-radius:4px;" />
          <br/><br/>
          <button type="submit" style="padding:10px 20px;font-size:16px;background:#25D366;color:#fff;border:none;border-radius:4px;cursor:pointer;">Get Pairing Code</button>
        </form>
        <p style="margin-top:20px;"><a href="/qr">Go to QR Scan</a></p>
      </body>
    </html>
  `);
});

app.post('/link', async (req, res) => {
  if (isConnected) {
    return res.send('<h2>✅ WhatsApp already connected.</h2>');
  }

  const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
  if (!phone || phone.length < 10) {
    return res.send('<h2>❌ Invalid number format! Enter full number with country code (e.g. 919876543210).</h2><a href="/link">Back</a>');
  }

  try {
    // Agar socket active nahi hai ya restart ho raha hai, wait karo
    if (!currentSock || !currentSock.ws?.isOpen) {
      console.log('🔄 Re-starting socket before pairing request...');
      await startBot();
      await delay(3000); // Allow socket to stabilize with WhatsApp gateway
    }

    // Stabilize delay before pairing handshake
    await delay(1500);

    const code = await currentSock.requestPairingCode(phone);
    const formatted = code?.match(/.{1,4}/g)?.join('-') || code;

    res.send(`
      <html>
        <body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;margin-top:40px;">
          <h2>Your WhatsApp Pairing Code</h2>
          <p style="font-size:42px;font-weight:bold;letter-spacing:4px;background:#f0f0f0;padding:15px 30px;border-radius:8px;color:#128C7E;">${formatted}</p>
          <div style="max-width:400px;text-align:left;line-height:1.6;">
            <b>Steps on your phone:</b>
            <ol>
              <li>Open WhatsApp</li>
              <li>Tap <b>Linked Devices</b> → <b>Link a Device</b></li>
              <li>Tap <b>"Link with phone number instead"</b></li>
              <li>Enter the 8-digit code above</li>
            </ol>
          </div>
          <p style="color:red;font-weight:bold;">⚠️ Code expires in ~60 seconds</p>
          <a href="/link">Request new code</a>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Pairing code generation failed:', err);
    
    // Agar socket drop ho gaya, auto-reinitiate for next attempt
    setTimeout(() => {
      startBot().catch((e) => console.error('Background recovery error:', e));
    }, 2000);

    res.send(`
      <html>
        <body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;margin-top:40px;">
          <h2>❌ Pairing Failed: ${err.message || 'Connection Closed'}</h2>
          <p>WhatsApp server ne temporary handshake drop kar diya.</p>
          <p><b>Koshish karein:</b> 10 second wait karke fir se submit karein.</p>
          <a href="/link" style="padding:10px 20px;background:#007bff;color:#fff;text-decoration:none;border-radius:4px;">Try Again</a>
        </body>
      </html>
    `);
  }
});

async function startBot() {
  if (isConnecting) return;
  isConnecting = true;

  try {
    const { state, saveCreds } = await useSupabaseAuthState(SESSION_ID);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Ubuntu', 'Chrome', '20.0.04'], // Standard accepted string format
      syncFullHistory: false,
      markOnlineOnConnect: true,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
    });

    currentSock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) latestQR = qr;

      if (connection === 'close') {
        isConnected = false;
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`⚠️ Connection closed (Status code: ${statusCode}). Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => {
            isConnecting = false;
            startBot().catch((err) => console.error('Auto-reconnect failed:', err));
          }, 4000);
        } else {
          isConnecting = false;
          console.log('🔒 Logged out. Clear Supabase `sessions` table and restart.');
        }
      } else if (connection === 'open') {
        isConnected = true;
        isConnecting = false;
        latestQR = null;
        console.log('✅ WhatsApp successfully connected!');
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

  } catch (initErr) {
    isConnecting = false;
    console.error('Socket initialization error:', initErr);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

startBot().catch((err) => console.error('❌ Boot failed:', err));
