function startBot() {
  const { state, saveCreds } = await useSupabaseAuthState(SESSION_ID);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Koko Coin Bot', 'Chrome', '1.0.0'],
  });

  // Every time Baileys rotates/updates credentials or signal keys, persist
  // them to Supabase immediately — this is what makes the login survive a
  // Render restart instead of needing a fresh QR scan every time.
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      qrcodeTerminal.generate(qr, { small: true });
      console.log('📱 Scan the QR above, or open /qr in your browser');
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('⚠️  Connection closed. Reconnecting:', shouldReconnect);

      if (shouldReconnect) {
        startBot().catch((err) => console.error('Reconnect failed:', err));
      } else {
        console.log(
          '🔒 Logged out from WhatsApp. Delete this session_id\'s rows from the ' +
            '"sessions" table in Supabase, then restart the service and rescan the QR.'
        );
      }
    } else if (connection === 'open') {
      isConnected = true;
      latestQR = null;
      console.log('✅ WhatsApp connected successfully!');
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
  console.log('   Health check: /health');
  console.log('   QR code:      /qr');
});

startBot().catch((err) => console.error('❌ Failed to start
